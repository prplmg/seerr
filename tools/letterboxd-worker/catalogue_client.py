"""Account-bound Seerr scheduling and pilot writes. No browser cookies leave Edge."""
import json
import time
import ssl
import re
import traceback
import uuid
from http.client import HTTPSConnection
from urllib.request import Request, build_opener, HTTPRedirectHandler, HTTPSHandler, ProxyHandler
from urllib.parse import urlencode
from urllib.error import HTTPError

ENDPOINT = 'https://catalogue.prpl.com.mx:8443/api/v1/letterboxd-worker/exchange'
SUPPORTED_WRITE_KINDS = ('rating', 'review', 'diary')

class CatalogueOriginConnection(HTTPSConnection):
    """Dial our LAN origin, retaining the public hostname for TLS verification."""
    def connect(self):
        if self.host != 'catalogue.prpl.com.mx' or self.port != 8443:
            raise ValueError('Unexpected catalogue origin')
        sock = self._create_connection(('192.168.68.55', 8443), self.timeout, self.source_address)
        try:
            self.sock = self._context.wrap_socket(sock, server_hostname=self.host)
        except Exception:
            sock.close()
            raise

class CatalogueOriginHandler(HTTPSHandler):
    def https_open(self, req):
        return self.do_open(CatalogueOriginConnection, req, context=ssl.create_default_context())

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

class CatalogueClient:
    def record_failure(self, instance, stage, error):
        # Keep an append-only bounded history, not just the last successful poll.
        known = ('Invalid ', 'Unsupported ', 'Unexpected ', 'Wrong ', 'Unverified ',
                 'Missing ', 'Required ', 'Account already ', 'Job identity ',
                 'Write payload ', 'Write account ', 'Observation payload ',
                 'Unbound ', 'Catalogue response ', 'database is locked')
        # Unknown exception strings can contain private review text or tokens.
        message = str(error) if isinstance(error,ValueError) and str(error).startswith(known) else type(error).__name__
        message = re.sub(r'https?://\S+', '[url]', message)
        message = re.sub(r'(?i)(bearer\s+|(?:token|password|apikey|authorization)[\s:=]+)[^\s,;]+', r'\1[redacted]', message)
        failure = {'at':time.time(),'instance':instance,'stage':stage,
                   'type':type(error).__name__,'message':message[:500],
                   'frames':[{'function':f.name,'line':f.lineno} for f in traceback.extract_tb(error.__traceback__)[-4:]]}
        code=getattr(error,'code',None)
        if isinstance(code,int):failure['httpStatus']=code
        errno=getattr(error,'errno',None)
        if isinstance(errno,int):failure['errno']=errno
        intent=getattr(self,'delivery_id',None)
        if isinstance(intent,str) and re.fullmatch(r'[a-f0-9-]{36}',intent):failure['intentId']=intent
        file=self.config_path.parent/'transport-errors.jsonl'
        try:
            if file.exists() and file.stat().st_size>1024*1024:
                file.replace(file.with_suffix('.previous.jsonl'))
            with file.open('a',encoding='utf-8') as out:out.write(json.dumps(failure)+'\n')
        except OSError:
            pass  # Diagnostics must never alter delivery semantics.
        if stage in ('publishing','heartbeat','lists'):
            try:
                target=self.config_path.parent/'account-health.json'
                state=json.loads(target.read_text()) if target.exists() else {}
                state.setdefault(instance,{})[stage]={'stage':stage,'at':int(time.time()*1000),'type':type(error).__name__,**({'httpStatus':code} if isinstance(code,int) else {})}
                temp=target.with_suffix('.tmp');temp.write_text(json.dumps(state));temp.replace(target)
            except (OSError,ValueError,TypeError): pass
        return failure

    def worker_health(self, instance):
        account = self.queue.db.execute('SELECT paused FROM accounts WHERE instance=?',(instance,)).fetchone()
        paused = bool(account and account['paused'])
        reason = 'none'
        if paused:
            reason = 'read-check' if self.queue.db.execute('SELECT 1 FROM readonly_pauses WHERE instance=?',(instance,)).fetchone() else 'watchdog' if self.queue.db.execute('SELECT 1 FROM watchdog_pauses WHERE instance=?',(instance,)).fetchone() else 'uncertain-write' if self.queue.db.execute("SELECT 1 FROM jobs WHERE instance=? AND action='media_write' AND state IN ('blocked','unknown')",(instance,)).fetchone() else 'manual'
        try: errors = list(json.loads((self.config_path.parent/'account-health.json').read_text()).get(instance,{}).values())
        except (OSError,ValueError,AttributeError): errors=[]
        kinds=self.supported_writes(instance)
        if self.workflow_capable(instance): kinds.append('diary-content')
        return {'paused':paused,'pauseReason':reason,'supportedWriteKinds':kinds,'errors':errors[-3:]}

    def supported_writes(self, instance):
        kinds=list(SUPPORTED_WRITE_KINDS)
        try:
            version=json.loads((self.config_path.parent/'worker-versions.json').read_text()).get(instance,{})
            if version.get('version')=='0.2.48' and 0 <= time.time()-version.get('seenAt',0) < 600:
                kinds.append('watched')
        except (OSError,ValueError,TypeError): pass
        return kinds

    def recover_read_pause(self, instance):
        # Only recover a positively identified read-induced pause. Manual or
        # uncertain mutation holds remain untouched. Probe performs no writes.
        row=self.queue.db.execute('SELECT a.paused,j.created FROM accounts a JOIN readonly_pauses p ON p.instance=a.instance JOIN jobs j ON j.id=p.job WHERE a.instance=?',(instance,)).fetchone()
        if not row or not row['paused']: return
        if self.queue.db.execute("SELECT 1 FROM jobs WHERE instance=? AND (state IN ('queued','offered','running') OR (action NOT IN ('identity_probe','review_observe','watchlist_scan','export_scan','list_scan') AND state IN ('unknown','blocked') AND created>=?))",(instance,row['created'])).fetchone(): return
        last=self.queue.db.execute("SELECT MAX(created) FROM jobs WHERE instance=? AND action='identity_probe'",(instance,)).fetchone()[0]
        if last and time.time()-last < 900: return
        self.queue.enqueue('identity_probe',instance)

    def exchange_cycle(self, instance):
        # Publishing failures must not suppress the independent health/read path.
        # Do not retry writes here; durable delivery/recovery owns that decision.
        failures = []
        try: self.recover_read_pause(instance)
        except Exception as error: self.record_failure(instance,'heartbeat',error)
        for stage, exchange in (('publishing', self.exchange_writes), ('heartbeat', self.exchange), ('lists',self.exchange_lists)):
            if stage=='lists' and failures:continue
            try:
                exchange(instance)
            except Exception as error:
                self.record_failure(instance, stage, error)
                failure = {'stage': stage, 'type': type(error).__name__}
                code = getattr(error, 'code', None)
                if isinstance(code, int):
                    failure['httpStatus'] = code
                failures.append(failure)
        return failures

    def workflow_capable(self, instance):
        # Advertise only a freshly observed, loaded browser version—not merely
        # files copied to disk or a global flag shared by other profiles.
        try:
            version=json.loads((self.config_path.parent/'worker-versions.json').read_text()).get(instance,{})
            age=time.time()-version.get('seenAt',0)
            return version.get('version') in ('0.2.46','0.2.47','0.2.48') and 0 <= age < 600
        except (OSError,ValueError,TypeError):
            return False

    def __init__(self, queue, config_path, send=None):
        self.queue = queue
        self.config_path = config_path
        self.send = send or self.request
        self.last_attempt = {}

    @staticmethod
    def pending(token, instance):
        url = ENDPOINT.replace('/exchange', '/pending') + '?' + urlencode({'instance':instance})
        request = Request(url, headers={'Authorization':'Bearer '+token})
        with build_opener(ProxyHandler({}), NoRedirect, CatalogueOriginHandler()).open(request, timeout=8) as response:
            if response.geturl() != url:
                raise ValueError('Unexpected catalogue redirect')
            return json.loads(response.read(4096))

    @staticmethod
    def request(token, payload, writes=False, observations=False, lists=False):
        endpoint=ENDPOINT.replace('/exchange','/lists') if lists else ENDPOINT.replace('/exchange','/observations') if observations else ENDPOINT.replace('/exchange','/writes') if writes else ENDPOINT
        request = Request(endpoint, data=json.dumps(payload).encode(), headers={
            'Authorization':'Bearer '+token, 'Content-Type':'application/json'}, method='POST')
        # No caller-supplied URL, browser session or general Seerr API key.
        with build_opener(ProxyHandler({}), NoRedirect, CatalogueOriginHandler()).open(request, timeout=8) as response:
            if response.geturl() != endpoint:
                raise ValueError('Unexpected catalogue redirect')
            # Review text may be 50k Unicode characters (JSON escapes can be
            # considerably larger). Keep a bounded response, without truncation.
            body=response.read(1024*1024+1)
            if len(body)>1024*1024:raise ValueError('Catalogue response too large')
            return json.loads(body)

    def exchange_writes(self, instance):
        self.delivery_id=None
        if not self.config_path.exists(): return
        config=json.loads(self.config_path.read_text())
        expected=config.get('accounts',{}).get(instance)
        if instance not in config.get('instances',[]) or not expected: return
        payload={'version':1,'instance':instance,'supported':self.supported_writes(instance),'durableDelivery':1}
        if self.workflow_capable(instance):
            payload['supported'].append('diary-content')
        row=self.queue.db.execute("SELECT j.* FROM jobs j JOIN write_payloads w ON w.id=j.id LEFT JOIN write_acks a ON a.id=j.id WHERE j.instance=? AND a.id IS NULL ORDER BY j.created LIMIT 1",(instance,)).fetchone()
        if row:
            if row['state'] in ('queued','offered','running'): return
            result=json.loads(row['result'] or '{}')
            payload['report']={'id':row['id'],'outcome':'verified' if row['state']=='succeeded' else 'conflict' if result.get('writeOutcome')=='conflict' else 'unknown','identity':result.get('identity'),'values':result.get('values')}
            if result.get('entryId'):
                payload['report']['entryId']=result['entryId']
        # Deliver durable write outcomes before claiming any more observations.
        # Otherwise observations can starve the acknowledgement (and UI badge).
        if not row and self.exchange_observations(instance): return
        account=self.queue.db.execute('SELECT * FROM accounts WHERE instance=?',(instance,)).fetchone()
        if not account or account['username']!=expected:raise ValueError('Unverified write profile')
        if account['paused'] and not row:return
        if not row and self.queue.db.execute("SELECT 1 FROM jobs WHERE instance=? AND action!='list_scan' AND state IN ('queued','offered','running')",(instance,)).fetchone():return
        job=self.request(config['token'],payload,writes=True)
        self.delivery_id=job.get('id')
        if job.get('action') not in ('idle','media_write'):raise ValueError('Unsupported write action')
        if 'report' in payload:
            with self.queue.db:self.queue.db.execute('INSERT OR IGNORE INTO write_acks VALUES(?)',(row['id'],))
        if job.get('action')=='idle':return
        if job.get('kind') not in self.supported_writes(instance):raise ValueError('Unsupported write kind')
        if job.get('instance')!=instance or job.get('account')!=expected:raise ValueError('Wrong write account')
        self.queue.enqueue('media_write',instance,job['id'],payload=job)

    def exchange_observations(self, instance):
        if not self.config_path.exists(): return False
        config=json.loads(self.config_path.read_text())
        expected=config.get('accounts',{}).get(instance)
        if instance not in config.get('instances',[]) or not expected: return False
        # Explicit install-time capability: existing browser versions get no new action.
        supported=config.get('supportedObservations',[])
        if supported not in ([],['review_observe']): raise ValueError('Invalid observation capabilities')
        row=self.queue.db.execute("SELECT j.*,o.payload FROM jobs j JOIN observation_payloads o ON o.id=j.id LEFT JOIN observation_acks a ON a.id=j.id WHERE j.instance=? AND a.id IS NULL ORDER BY j.created LIMIT 1",(instance,)).fetchone()
        if not supported and not row:return False
        if row and row['state'] in ('queued','offered','running'):return True
        account=self.queue.db.execute('SELECT * FROM accounts WHERE instance=?',(instance,)).fetchone()
        if not account or account['username']!=expected:raise ValueError('Unverified observation profile')
        # Read-only recovery may run while writes are paused. It never submits a form.
        if self.queue.db.execute("SELECT 1 FROM jobs WHERE instance=? AND action!='list_scan' AND state IN ('queued','offered','running')",(instance,)).fetchone():return True
        payload={'version':1,'instance':instance,'supported':supported}
        if row:
            intent=json.loads(row['payload']);result=json.loads(row['result'] or '{}')
            report={k:intent[k] for k in ('userId','account','film','entryId','claimToken','createNew') if k in intent}
            report.update(id=row['id'],status='verified' if row['state']=='succeeded' else 'ambiguous' if result.get('observationStatus')=='ambiguous' else 'unknown',
                          identityVerified=result.get('identity')==intent['account'],complete=result.get('complete') is True)
            if row['state']=='succeeded':report['observation']=result['observation']
            payload['report']=report
        job=self.request(config['token'],payload,observations=True)
        if job.get('action') not in ('idle','review_observe'):raise ValueError('Unsupported observation action')
        if job.get('action')=='review_observe' and (not supported or row or job.get('instance')!=instance or job.get('account')!=expected):
            raise ValueError('Unexpected observation claim')
        if row:
            with self.queue.db:
                for recovered in job.get('recovered',[]):
                    original=self.queue.db.execute('SELECT j.state,w.payload FROM jobs j JOIN write_payloads w ON w.id=j.id WHERE j.id=? AND j.instance=?',(recovered.get('id'),instance)).fetchone()
                    if not original or original['state'] not in ('unknown','succeeded'):raise ValueError('Unexpected recovered write')
                    intent=json.loads(original['payload'])
                    if recovered.get('values')!=intent['desired'] or intent.get('kind')!='review':raise ValueError('Recovery values mismatch')
                    entry=recovered.get('entryId','')
                    from queue_store import valid_entry
                    if not valid_entry(entry,intent) or (intent.get('entryId') and intent['entryId']!=entry):raise ValueError('Recovery entry mismatch')
                    result={'outcome':'succeeded','writeOutcome':'verified','identity':intent['account'],'values':intent['desired'],'entryId':entry,'recoveredBy':row['id']}
                    self.queue.db.execute("UPDATE jobs SET state='succeeded',result=? WHERE id=?",(json.dumps(result),recovered['id']))
                if job.get('resumeWrites') is True and job.get('recovered'):
                    self.queue.db.execute('UPDATE accounts SET paused=0 WHERE instance=?',(instance,))
                self.queue.db.execute('INSERT OR IGNORE INTO observation_acks VALUES(?)',(row['id'],))
            return False
        if job.get('action')=='idle':return False
        self.queue.enqueue('review_observe',instance,job['id'],payload=job)
        return True

    def exchange_lists(self,instance):
        if not self.config_path.exists():return
        now=time.time()
        if now-self.last_attempt.get('lists:'+instance,0)<45:return
        self.last_attempt['lists:'+instance]=now
        config=json.loads(self.config_path.read_text())
        if instance not in config.get('instances',[]):return
        account=self.queue.db.execute('SELECT * FROM accounts WHERE instance=?',(instance,)).fetchone()
        if not account or account['username']!=config.get('accounts',{}).get(instance):raise ValueError('Unverified catalogue profile')
        row=self.queue.db.execute("SELECT j.*,p.payload FROM jobs j JOIN list_payloads p ON p.id=j.id LEFT JOIN list_acks a ON a.id=j.id WHERE j.instance=? AND a.id IS NULL AND j.state IN ('succeeded','blocked','unknown') ORDER BY created LIMIT 1",(instance,)).fetchone()
        try:
            version=json.loads((self.config_path.parent/'worker-versions.json').read_text()).get(instance,{})
            capable=version.get('version')=='0.2.48' and version.get('inPrivateAllowed') is True and 0<=now-version.get('seenAt',0)<600
        except (OSError,ValueError,TypeError):capable=False
        if not capable and not row:return
        if self.queue.db.execute("SELECT 1 FROM jobs WHERE instance=? AND state IN ('queued','running','offered')",(instance,)).fetchone():return
        payload={'version':1,'instance':instance,'supported':True,'inPrivateAllowed':capable}
        if row:
            result=json.loads(row['result'] or '{}');intent=json.loads(row['payload'])
            payload['report']={'id':row['id'],'token':intent['token'],'outcome':row['state']}
            for key in ('snapshot','error'):
                if key in result:payload['report'][key]=result[key]
        try:
            job=self.send(config['token'],payload,lists=True)
        except HTTPError as error:
            retired=False
            if row and error.code==410:
                try: retired=json.loads(error.read(4096)).get('code')=='list-job-retired'
                except (ValueError,AttributeError): pass
            if not retired: raise
            # Keep the original snapshot before acknowledging an absent server job.
            # Never reinterpret token/account mismatches (409) as retirement.
            archive=self.config_path.parent/'retired-list-reports'
            archive.mkdir(exist_ok=True)
            file=archive/(row['id']+'.json')
            saved={'id':row['id'],'instance':instance,'payload':row['payload'],'result':row['result'],'reason':'list-job-retired'}
            if file.exists():
                if json.loads(file.read_text())!=saved: raise ValueError('List archive identity mismatch')
            else:
                temp=file.with_suffix('.'+str(uuid.uuid4())+'.tmp')
                try:
                    with temp.open('x',encoding='utf-8') as out:json.dump(saved,out)
                    temp.replace(file)
                finally:
                    if temp.exists():temp.unlink()
            with self.queue.db:self.queue.db.execute('INSERT OR IGNORE INTO list_acks VALUES(?)',(row['id'],))
            return

        if job.get('action') not in ('idle','list_scan'):raise ValueError('Invalid list job')
        if row:
            with self.queue.db:self.queue.db.execute('INSERT OR IGNORE INTO list_acks VALUES(?)',(row['id'],))
        if job.get('action')=='idle':return
        if job.get('instance')!=instance or job.get('account')!=account['username']:raise ValueError('List account mismatch')
        self.queue.enqueue('list_scan',instance,job['id'],payload=job)

    def exchange(self, instance):
        if not self.config_path.exists():
            return
        now = time.time()
        if now - self.last_attempt.get(instance, 0) < 45:
            return
        self.last_attempt[instance] = now
        config = json.loads(self.config_path.read_text())
        if instance not in config.get('instances', []):
            return
        account = self.queue.db.execute('SELECT * FROM accounts WHERE instance=?', (instance,)).fetchone()
        expected = config.get('accounts', {}).get(instance)
        if not account or account['username'] != expected:
            raise ValueError('Unverified catalogue profile')
        self.queue.expire()
        payload = {'version':1, 'instance':instance, 'exportCapable':config.get('exportCapable') is True, 'workerHealth':self.worker_health(instance)}
        row = self.queue.db.execute('SELECT j.* FROM catalogue_jobs c JOIN jobs j ON j.id=c.id LEFT JOIN catalogue_acks a ON a.id=j.id WHERE c.instance=? AND a.id IS NULL ORDER BY j.created DESC LIMIT 1', (instance,)).fetchone()
        if row and row['state'] in ('succeeded','blocked','unknown'):
            result = json.loads(row['result'] or '{}')
            allowed = {'identity','complete','items','challenge','encoded','capturedAt','error'}
            payload['report'] = {key:value for key,value in result.items() if key in allowed}
            payload['report'].update(id=row['id'], outcome=row['state'])
        job = self.send(config['token'], payload)
        if job.get('action') not in ('idle', 'watchlist_scan', 'export_scan'):
            raise ValueError('Unexpected catalogue action')
        if 'report' in payload:
            with self.queue.db:
                self.queue.db.execute('INSERT OR IGNORE INTO catalogue_acks VALUES(?)',(payload['report']['id'],))
        if job.get('action') == 'idle':
            return
        if job.get('action') not in ('watchlist_scan','export_scan') or job.get('instance') != instance or job.get('account') != account['username']:
            raise ValueError('Unexpected catalogue job')
        job_id = self.queue.enqueue(job['action'], instance, job['id'])
        with self.queue.db:
            self.queue.db.execute('INSERT OR IGNORE INTO catalogue_jobs VALUES(?,?)',(job_id,instance))
