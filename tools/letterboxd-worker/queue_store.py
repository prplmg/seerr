"""Durable account-bound pilot jobs. No automatic retries of claimed jobs."""
import json
import sqlite3
import time
import uuid
import re
import math
import base64
from datetime import date

INSTANCE = '7cb664cd-13ca-4d8e-ae8a-c3882547643c'
ACTIONS = {'identity_probe', 'watchlist_probe', 'watchlist_cycle', 'watchlist_restore', 'cleanup_tabs', 'watchlist_scan', 'close_profile_for_test', 'media_write', 'review_probe', 'review_existing_probe'}
ACTIONS.add('review_observe')
ACTIONS.add('review_cleanup')
ACTIONS.add('review_history_probe')
ACTIONS.add('export_scan')
ACTIONS.add('list_scan')

def list_payload(payload):
    if not isinstance(payload,dict) or not isinstance(payload.get('url'),str) or not re.fullmatch(r'https://(?:letterboxd\.com/[a-zA-Z0-9_]+/list/[a-zA-Z0-9-]+/|boxd\.it/[a-zA-Z0-9]+/?)',payload['url']):
        raise ValueError('Invalid list URL')
    if str(uuid.UUID(payload.get('token',''))) != payload['token']:raise ValueError('Invalid list claim')
    return {key:payload[key] for key in ('url','token')}

def valid_account_payload(payload):
    return (isinstance(payload, dict) and type(payload.get('userId')) is int
            and 0 < payload['userId'] <= 9007199254740991
            and isinstance(payload.get('account'), str)
            and re.fullmatch(r'[a-z0-9_]{1,40}', payload['account']) is not None)

def observation_payload(payload):
    if not valid_account_payload(payload):
        raise ValueError('Invalid observation identity')
    if not isinstance(payload.get('film'),str) or len(payload['film'])>200 or not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*',payload['film']):
        raise ValueError('Invalid observation film')
    if str(uuid.UUID(payload.get('claimToken',''))) != payload['claimToken']:
        raise ValueError('Invalid observation claim')
    if type(payload.get('claimedAt')) not in (int,float) or not math.isfinite(payload['claimedAt']) or payload['claimedAt'] < 0:
        raise ValueError('Invalid observation time')
    if 'entryId' in payload and not valid_entry(payload['entryId'],payload):
        raise ValueError('Invalid observation entry')
    if 'createNew' in payload and (payload['createNew'] is not True or payload.get('entryId')):
        raise ValueError('Invalid new review observation')
    return {k:payload[k] for k in ('userId','account','film','entryId','claimToken','claimedAt','createNew') if k in payload}

def validate_observation_result(intent, result):
    o=result.get('observation')
    if result.get('identity') != intent['account'] or result.get('complete') is not True or result.get('observationStatus') != 'verified':
        raise ValueError('Unverified observation')
    if not isinstance(o,dict) or set(o)-{'rating','text','spoiler','observedAt','entryId','watched','diaryEntriesComplete','diaryEntryIds','diaryEntryDates'} or not {'rating','text','spoiler','observedAt'} <= set(o):
        raise ValueError('Incomplete observation')
    # Reuse strict ReviewFields validation, without accepting an outbound action.
    values={k:o[k] for k in ('rating','text','spoiler')}
    write_payload({**{k:v for k,v in intent.items() if k!='createNew'},'kind':'review','originEntityId':'observation','expected':values,'desired':values})
    if intent.get('createNew') and (o.get('entryId') or o['text'] or o['spoiler']):raise ValueError('Not a new review baseline')
    if type(o['observedAt']) not in (int,float) or not math.isfinite(o['observedAt']) or o['observedAt'] < intent['claimedAt']:
        raise ValueError('Invalid observation time')
    if ('entryId' in o and not valid_entry(o['entryId'],intent)) or (intent.get('entryId') and o.get('entryId') != intent['entryId']) or (o['text'] and not o.get('entryId')):
        raise ValueError('Unverified observation entry')
    # Optional evidence from newer workers; absence stays unknown. Completeness
    # means all dated diary entries for this account/film across every page,
    # not just reviews, a selected date, or the visible first page.
    if 'watched' in o and type(o['watched']) is not bool:
        raise ValueError('Invalid watched observation')
    if 'diaryEntriesComplete' in o or 'diaryEntryIds' in o:
        entries=o.get('diaryEntryIds')
        if type(o.get('diaryEntriesComplete')) is not bool or not isinstance(entries,list) or len(entries)>1000:
            raise ValueError('Invalid diary inventory')
        if any(not isinstance(entry,str) or len(entry)>500 or not valid_entry(entry,intent) for entry in entries):
            raise ValueError('Invalid diary entry')
        if len(set(entries)) != len(entries):
            raise ValueError('Duplicate diary entry')
    if 'diaryEntryDates' in o:
        dates=o['diaryEntryDates']
        if not isinstance(dates,dict) or 'diaryEntryIds' not in o or set(dates) != set(o['diaryEntryIds']):
            raise ValueError('Invalid diary entry dates')
        for value in dates.values():
            if not isinstance(value,str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',value) or date.fromisoformat(value).isoformat() != value:
                raise ValueError('Invalid diary entry date')

def write_payload(payload):
    fields = {'rating': {'rating'}, 'review': {'rating','text','spoiler'},
              'watched': {'watched'}, 'diary': {'watchedDate','rewatch'}}
    if not isinstance(payload, dict) or payload.get('kind') not in fields:
        raise ValueError('Unsupported write kind')
    if payload['kind'] == 'diary' and isinstance(payload.get('desired'), dict) and 'rating' in payload['desired']:
        fields['diary'] = {'watchedDate','rewatch','rating','text','spoiler'}
    if 'createNew' in payload and (payload['createNew'] is not True or payload['kind']!='review' or payload.get('entryId') or not payload.get('desired',{}).get('text')):raise ValueError('Invalid create mode')
    if payload.get('previousEntryId') and (not payload.get('createNew') or not valid_entry(payload['previousEntryId'],payload)):raise ValueError('Invalid previous entry')
    if not isinstance(payload.get('film'), str) or not re.fullmatch(r'[a-z0-9-]{1,200}', payload['film']):
        raise ValueError('Invalid film')
    for side in ('expected','desired'):
        values = payload.get(side)
        if not isinstance(values, dict) or set(values) != fields[payload['kind']]:
            raise ValueError('Incomplete write precondition')
        for key, value in values.items():
            if key in ('spoiler','watched','rewatch') and type(value) is not bool:
                raise ValueError('Invalid boolean')
            if key == 'rating' and value is not None and (type(value) not in (int,float) or not 0.5 <= value <= 5 or value * 2 != int(value * 2)):
                raise ValueError('Invalid rating')
            if key == 'text' and (not isinstance(value,str) or len(value)>50000):
                raise ValueError('Invalid review')
            if key == 'watchedDate' and not (side == 'expected' and value is None):
                if not isinstance(value,str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',value) or date.fromisoformat(value).isoformat() != value:
                    raise ValueError('Invalid diary date')
    if payload.get('entryId') is not None and not valid_entry(payload['entryId'],payload):
        raise ValueError('Invalid entry identity')
    if payload['kind'] in ('review','diary') and not payload.get('originEntityId'):
        raise ValueError('Missing local entry identity')
    for key in ('originId','originEntityId'):
        if key in payload and (not isinstance(payload[key],str) or not 0 < len(payload[key]) <= 300):
            raise ValueError('Invalid origin identity')
    return {k:payload[k] for k in ('userId','account','kind','film','expected','desired','entryId','originId','originEntityId','createNew','previousEntryId') if k in payload}

def valid_entry(entry, payload):
    return isinstance(entry,str) and re.fullmatch(
        r'https://letterboxd\.com/' + re.escape(payload['account']) + r'/film/' + re.escape(payload['film']) + r'/(?:[1-9][0-9]*/)?', entry) is not None

class Queue:
    def __init__(self, path):
        self.db = sqlite3.connect(path, timeout=10)
        self.db.row_factory = sqlite3.Row
        self.db.executescript('''
          PRAGMA journal_mode=WAL;
          CREATE TABLE IF NOT EXISTS accounts(instance TEXT PRIMARY KEY, username TEXT NOT NULL, paused INTEGER NOT NULL DEFAULT 0);
          CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, instance TEXT NOT NULL, action TEXT NOT NULL, state TEXT NOT NULL, created REAL NOT NULL, claimed REAL, result TEXT);
          CREATE TABLE IF NOT EXISTS events(job TEXT NOT NULL, time REAL NOT NULL, payload TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS watchlist_snapshots(instance TEXT PRIMARY KEY, account TEXT NOT NULL, job TEXT NOT NULL, captured REAL NOT NULL, items TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS catalogue_jobs(id TEXT PRIMARY KEY, instance TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS catalogue_acks(id TEXT PRIMARY KEY);
          CREATE TABLE IF NOT EXISTS write_payloads(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS write_acks(id TEXT PRIMARY KEY);
          CREATE TABLE IF NOT EXISTS observation_payloads(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS observation_acks(id TEXT PRIMARY KEY);
          CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY, payload TEXT NOT NULL, execution TEXT);
          CREATE TABLE IF NOT EXISTS watchdog_pauses(instance TEXT PRIMARY KEY, since REAL NOT NULL);
          CREATE TABLE IF NOT EXISTS readonly_pauses(instance TEXT PRIMARY KEY, job TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS list_payloads(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS list_acks(id TEXT PRIMARY KEY);
        ''')
        self.db.execute('INSERT OR IGNORE INTO accounts VALUES(?,?,0)', (INSTANCE, 'prplmg'))
        self.db.commit()

    def enqueue(self, action, instance=INSTANCE, job_id=None, payload=None):
        if action not in ACTIONS:
            raise ValueError('Unsupported action')
        if action == 'media_write':
            if not valid_account_payload(payload):
                raise ValueError('Invalid write account')
            payload = write_payload(payload)
        if action == 'review_observe':
            payload = observation_payload(payload)
        if action == 'list_scan':payload = list_payload(payload)
        if job_id is not None:
            job_id = str(uuid.UUID(job_id))
            existing = self.db.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone()
            if existing:
                if existing['instance'] != instance or existing['action'] != action:
                    raise ValueError('Job identity collision')
                if action == 'list_scan':
                    saved=self.db.execute('SELECT payload FROM list_payloads WHERE id=?',(job_id,)).fetchone()
                    if not saved or json.loads(saved[0])!=payload:raise ValueError('List identity collision')
                if action == 'media_write':
                    saved=self.db.execute('SELECT payload FROM write_payloads WHERE id=?',(job_id,)).fetchone()
                    expected=payload
                    if not saved or json.loads(saved[0])!=expected:
                        raise ValueError('Write payload identity collision')
                if action == 'review_observe':
                    saved=self.db.execute('SELECT payload FROM observation_payloads WHERE id=?',(job_id,)).fetchone()
                    if not saved or json.loads(saved[0]) != payload: raise ValueError('Observation payload identity collision')
                return job_id
        account = self.db.execute('SELECT * FROM accounts WHERE instance=?', (instance,)).fetchone()
        if not account or (account['paused'] and action not in ('identity_probe','review_observe','review_probe','review_existing_probe','review_history_probe','cleanup_tabs','watchlist_scan','export_scan','list_scan')):
            raise ValueError('Unbound or paused account')
        if action in ('media_write','review_observe') and account['username'] != payload['account']:
            raise ValueError('Write account changed')
        if action == 'close_profile_for_test' and (instance != '6e282ef9-86a2-4356-9387-16f99807e283' or account['username'] != 'prplmg'):
            raise ValueError('Only the explicitly authorized test profile may close')
        if self.db.execute("SELECT 1 FROM jobs WHERE instance=? AND state IN ('queued','running') AND (?='list_scan' OR action!='list_scan')", (instance,action)).fetchone():
            raise ValueError('Account already has pending work')
        if action == 'watchlist_restore':
            evidence = self.db.execute("SELECT e.payload FROM events e JOIN jobs j ON j.id=e.job WHERE j.instance=? AND j.action='watchlist_cycle' AND j.state='unknown'", (instance,)).fetchall()
            if not any(json.loads(r[0]).get('stage') == 'before-test-change' and json.loads(r[0]).get('original') is False for r in evidence):
                raise ValueError('No absent-state pilot baseline for recovery')
        if action not in ('identity_probe', 'cleanup_tabs','list_scan'):
            required = 'identity_probe' if action in ('watchlist_probe','watchlist_scan','export_scan','close_profile_for_test','media_write','review_observe','review_probe','review_existing_probe','review_history_probe') else 'watchlist_probe'
            if not self.db.execute("SELECT 1 FROM jobs WHERE instance=? AND action=? AND state='succeeded'", (instance, required)).fetchone():
                raise ValueError('Required successful probe missing')
        job = job_id or str(uuid.uuid4())
        self.db.execute('INSERT INTO jobs VALUES(?,?,?,\'queued\',?,NULL,NULL)', (job, instance, action, time.time()))
        if action == 'media_write':
            self.db.execute('INSERT INTO write_payloads VALUES(?,?)',(job,json.dumps(payload)))
        if action == 'review_observe':
            self.db.execute('INSERT INTO observation_payloads VALUES(?,?)',(job,json.dumps(payload)))
        if action == 'list_scan':self.db.execute('INSERT INTO list_payloads VALUES(?,?)',(job,json.dumps(payload)))
        self.db.commit()
        return job

    def track_pause(self, instance, job, action):
        # Never reinterpret a legacy/manual/write pause as a recoverable read pause.
        readonly = action in ('identity_probe','review_observe','watchlist_scan','export_scan')
        paused = self.db.execute('SELECT paused FROM accounts WHERE instance=?',(instance,)).fetchone()[0]
        if not readonly:
            self.db.execute('DELETE FROM readonly_pauses WHERE instance=?',(instance,))
        elif not paused or self.db.execute('SELECT 1 FROM readonly_pauses WHERE instance=?',(instance,)).fetchone():
            self.db.execute('INSERT OR REPLACE INTO readonly_pauses VALUES(?,?)',(instance,job))

    def expire(self):
        with self.db:
            # Each opened page is durable progress. Large watchlists must not expire
            # merely because the total scan takes longer than three minutes.
            stale = self.db.execute("SELECT id,instance,action FROM jobs j WHERE state='running' AND (COALESCE((SELECT MAX(time) FROM events e WHERE e.job=j.id),claimed)<? OR claimed<?)", (time.time()-180,time.time()-3600)).fetchall()
            for row in stale:
                delivery=self.db.execute('SELECT 1 FROM deliveries WHERE id=?',(row['id'],)).fetchone()
                progress=self.db.execute('SELECT 1 FROM events WHERE job=?',(row['id'],)).fetchone()
                if delivery and not progress:
                    self.db.execute("UPDATE jobs SET state='offered',claimed=NULL WHERE id=?",(row['id'],))
                    self.db.execute('UPDATE deliveries SET execution=NULL WHERE id=?',(row['id'],))
                    continue
                self.db.execute("UPDATE jobs SET state='unknown' WHERE id=?", (row['id'],))
                if row['action']=='list_scan':continue
                self.track_pause(row['instance'],row['id'],row['action'])
                self.db.execute('INSERT OR IGNORE INTO watchdog_pauses SELECT instance,? FROM accounts WHERE instance=? AND paused=0',(time.time(),row['instance']))
                self.db.execute('UPDATE accounts SET paused=1 WHERE instance=?', (row['instance'],))

    def start(self, instance, job, execution):
        if str(uuid.UUID(execution)) != execution: raise ValueError('Invalid execution')
        with self.db:
            row=self.db.execute('SELECT j.state,d.execution FROM jobs j JOIN deliveries d ON d.id=j.id WHERE j.id=? AND j.instance=?',(job,instance)).fetchone()
            if not row or row['state'] not in ('offered','running'): return False
            if row['execution'] is not None: return row['state']=='running' and row['execution']==execution
            self.db.execute('UPDATE deliveries SET execution=? WHERE id=?',(execution,job))
            self.db.execute("UPDATE jobs SET state='running',claimed=? WHERE id=?",(time.time(),job))
            return True

    def offer(self, instance):
        row=self.db.execute("SELECT d.payload FROM deliveries d JOIN jobs j ON j.id=d.id WHERE j.instance=? AND j.state='offered'",(instance,)).fetchone()
        if row: return json.loads(row['payload'])
        return self.claim(instance, delivery=True)

    def claim(self, instance, delivery=False):
        self.expire()
        self.db.execute('BEGIN IMMEDIATE')
        try:
            account = self.db.execute('SELECT * FROM accounts WHERE instance=?', (instance,)).fetchone()
            if not account or self.db.execute("SELECT 1 FROM jobs WHERE instance=? AND state IN ('running','offered')", (instance,)).fetchone():
                self.db.commit()
                return None
            row = self.db.execute("SELECT * FROM jobs WHERE instance=? AND state='queued' AND (?=0 OR action IN ('identity_probe','review_observe','review_probe','review_existing_probe','review_history_probe','cleanup_tabs','watchlist_scan','export_scan','list_scan')) ORDER BY CASE WHEN action='list_scan' THEN 1 ELSE 0 END, created LIMIT 1", (instance,account['paused'])).fetchone()
            if not row:
                self.db.commit()
                return None
            # Previously queued watchlist mutations must never escape this gate.
            if row['action'] == 'watchlist_set':
                self.track_pause(instance,row['id'],row['action'])
                self.db.execute("UPDATE jobs SET state='blocked',result=? WHERE id=?", (json.dumps({'outcome':'blocked','writeOutcome':'conflict','error':'Watchlist publishing disabled'}),row['id']))
                self.db.execute('UPDATE accounts SET paused=1 WHERE instance=?',(instance,))
                self.db.commit()
                return None
            observation=None
            if row['action'] == 'review_observe':
                observation=json.loads(self.db.execute('SELECT payload FROM observation_payloads WHERE id=?',(row['id'],)).fetchone()[0])
                observation_payload(observation)
                if observation['account'] != account['username']: raise ValueError('Observation account changed')
            self.db.execute('UPDATE jobs SET state=?,claimed=? WHERE id=?', ('offered' if delivery else 'running',time.time(),row['id']))
            job = {'id':row['id'], 'action':row['action'], 'account':account['username'], 'instance':instance}
            if row['action'] == 'media_write':
                job.update(json.loads(self.db.execute('SELECT payload FROM write_payloads WHERE id=?',(row['id'],)).fetchone()[0]))
            if row['action'] == 'review_observe':
                job.update(observation)
            if row['action']=='list_scan':job.update(list_payload(json.loads(self.db.execute('SELECT payload FROM list_payloads WHERE id=?',(row['id'],)).fetchone()[0])))
            if row['action'] == 'cleanup_tabs':
                events = self.db.execute('SELECT e.payload FROM events e JOIN jobs j ON e.job=j.id WHERE j.instance=?', (instance,)).fetchall()
                job['tabIds'] = sorted({p['tabId'] for event in events for p in [json.loads(event[0])] if p.get('stage') == 'opened-pilot-tab' and isinstance(p.get('tabId'), int)})
            if delivery:
                self.db.execute('INSERT INTO deliveries VALUES(?,?,NULL)',(row['id'],json.dumps(job)))
            self.db.commit()
            return job
        except Exception:
            self.db.rollback()
            raise

    def event(self, instance, job, payload, final=False, execution=None):
        row = self.db.execute('SELECT * FROM jobs WHERE id=? AND instance=?', (job,instance)).fetchone()
        delivery=self.db.execute('SELECT execution FROM deliveries WHERE id=?',(job,)).fetchone()
        if delivery and (not execution or delivery['execution'] != execution):raise ValueError('Stale execution')
        if row and final and row['state'] in ('succeeded','blocked','unknown') and row['result'] and json.loads(row['result'])==payload:
            return
        if row and final and row['state']=='succeeded' and row['action']=='media_write' and payload.get('outcome')=='succeeded':
            saved=json.loads(row['result'] or '{}')
            if all(saved.get(key)==payload.get(key) for key in ('identity','values','entryId')):
                return
        # A durable browser result may arrive after the watchdog expired it.
        # No resubmission has occurred; accept verified evidence through normal validation.
        if row and row['state']=='unknown' and row['result'] is None and final:
            if not self.db.execute('SELECT 1 FROM deliveries WHERE id=? AND execution IS NOT NULL',(job,)).fetchone():
                raise ValueError('Unknown execution')
        elif not row or row['state'] != 'running':
            raise ValueError('Job is not running for this instance')
        # Allow structured diagnostics only, never arbitrary response bodies or credentials.
        allowed = {'stage','outcome','tabId','identity','httpStatus','challenge','usernameMatches','formFields','watchlisted','original','restored','error','controls','closedTabs','skippedTabs','complete','items','values','writeOutcome','entryId'}
        allowed |= {'observation','observationStatus','encoded','capturedAt'}
        if row['action']=='list_scan':allowed.add('snapshot')
        if not isinstance(payload,dict) or set(payload)-allowed:
            raise ValueError('Invalid report fields')
        if final and payload.get('outcome') not in ('succeeded','blocked','unknown'):
            raise ValueError('Invalid outcome')
        if row['action']=='list_scan' and final and payload.get('outcome')=='succeeded':
            snapshot=payload.get('snapshot')
            if not isinstance(snapshot,dict) or snapshot.get('anonymous') is not True or snapshot.get('complete') is not True or len(json.dumps(snapshot).encode())>4*1024*1024:raise ValueError('Invalid anonymous list snapshot')
        if 'encoded' in payload or (row['action']=='export_scan' and payload.get('outcome')=='succeeded'):
            account=self.db.execute('SELECT username FROM accounts WHERE instance=?',(instance,)).fetchone()
            if not (row['action']=='export_scan' and final and payload.get('complete') is True and payload.get('identity')==account['username'] and isinstance(payload.get('encoded'),str) and len(payload['encoded'])<=14*1024*1024):
                raise ValueError('Invalid export')
            raw=base64.b64decode(payload['encoded'],validate=True)
            if not raw.startswith(b'PK') or type(payload.get('capturedAt')) not in (int,float) or not math.isfinite(payload['capturedAt']):raise ValueError('Invalid export archive')
        if row['action']=='review_observe' and final:
            intent=json.loads(self.db.execute('SELECT payload FROM observation_payloads WHERE id=?',(job,)).fetchone()[0])
            if payload.get('outcome')=='succeeded': validate_observation_result(intent,payload)
            elif payload.get('observationStatus') not in (None,'unknown','ambiguous'): raise ValueError('Invalid observation status')
        if row['action']=='media_write' and final:
            intent=json.loads(self.db.execute('SELECT payload FROM write_payloads WHERE id=?',(job,)).fetchone()[0])
            if payload.get('outcome')=='succeeded':
                write_payload({**intent,'desired':payload.get('values')})
            if payload.get('outcome')=='succeeded' and (payload.get('identity')!=intent['account'] or payload.get('values')!=intent['desired']):
                raise ValueError('Unverified write')
            if payload.get('outcome')=='succeeded' and intent['kind'] in ('review','diary') and (not valid_entry(payload.get('entryId'),intent) or (intent.get('entryId') and intent['entryId'] != payload.get('entryId'))):
                raise ValueError('Unverified entry identity')
        snapshot = payload.get('stage') == 'watchlist-snapshot'
        if 'items' in payload or ('complete' in payload and row['action'] not in ('review_observe','export_scan')) or snapshot:
            account = self.db.execute('SELECT username FROM accounts WHERE instance=?',(instance,)).fetchone()
            items = payload.get('items')
            if not (snapshot and final and row['action']=='watchlist_scan' and payload.get('outcome')=='succeeded' and payload.get('complete') is True and payload.get('identity')==account['username'] and isinstance(items,list) and len(items)<=5000):
                raise ValueError('Invalid snapshot')
            slugs=set()
            for item in items:
                if not isinstance(item,dict) or set(item)!={'slug','title'} or not isinstance(item['slug'],str) or not re.fullmatch(r'[a-z0-9-]{1,200}',item['slug']) or not isinstance(item['title'],str) or len(item['title'])>300 or item['slug'] in slugs:
                    raise ValueError('Invalid snapshot item')
                slugs.add(item['slug'])
        with self.db:
            if snapshot:
                self.db.execute('INSERT OR REPLACE INTO watchlist_snapshots VALUES(?,?,?,?,?)',(instance,payload['identity'],job,time.time(),json.dumps(payload['items'])))
            self.db.execute('INSERT INTO events VALUES(?,?,?)',(job,time.time(),json.dumps(payload)))
            if final:
                self.db.execute('UPDATE jobs SET state=?,result=? WHERE id=?',(payload['outcome'],json.dumps(payload),job))
                if row['state']=='unknown' and payload['outcome']=='succeeded' and row['action']!='list_scan':
                    self.db.execute('DELETE FROM write_acks WHERE id=?',(job,))
                    self.db.execute('DELETE FROM observation_acks WHERE id=?',(job,))
                    pause=self.db.execute('SELECT since FROM watchdog_pauses WHERE instance=?',(instance,)).fetchone()
                    if pause and not self.db.execute("SELECT 1 FROM jobs WHERE instance=? AND action!='list_scan' AND state IN ('unknown','blocked') AND COALESCE(claimed,created)>=?",(instance,pause['since']-3600)).fetchone():
                        self.db.execute('UPDATE accounts SET paused=0 WHERE instance=?',(instance,))
                        self.db.execute('DELETE FROM watchdog_pauses WHERE instance=?',(instance,))
                if payload['outcome'] != 'succeeded' and row['action']!='list_scan':
                    self.track_pause(instance,job,row['action'])
                    self.db.execute('UPDATE accounts SET paused=1 WHERE instance=?',(instance,))
                elif row['action'] in ('review_observe','identity_probe'):
                    account=self.db.execute('SELECT username FROM accounts WHERE instance=?',(instance,)).fetchone()
                    pause=self.db.execute('SELECT j.created FROM readonly_pauses p JOIN jobs j ON j.id=p.job WHERE p.instance=?',(instance,)).fetchone()
                    if pause and payload.get('identity')==account['username'] and not payload.get('challenge') and row['created']>=pause['created']:
                        # Newer uncertain mutations always win over successful reads.
                        unsafe=self.db.execute("SELECT 1 FROM jobs WHERE instance=? AND created>=? AND action NOT IN ('identity_probe','review_observe','watchlist_scan','export_scan','list_scan') AND state IN ('unknown','blocked')",(instance,pause['created'])).fetchone()
                        if not unsafe:
                            self.db.execute('UPDATE accounts SET paused=0 WHERE instance=?',(instance,))
                            self.db.execute('DELETE FROM readonly_pauses WHERE instance=?',(instance,))
                            self.db.execute('DELETE FROM watchdog_pauses WHERE instance=?',(instance,))

    def status(self):
        self.expire()
        return {'accounts':[dict(r) for r in self.db.execute('SELECT * FROM accounts')],
                'jobs':[dict(r) for r in self.db.execute('SELECT * FROM jobs ORDER BY created')],
                'events':[dict(r) for r in self.db.execute('SELECT * FROM events ORDER BY time')]}

if __name__ == '__main__':
    import argparse
    from pathlib import Path
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['status', *ACTIONS])
    parser.add_argument('--instance', default=INSTANCE)
    args = parser.parse_args()
    queue = Queue(Path(__file__).with_name('queue.sqlite'))
    print(json.dumps(queue.status() if args.command == 'status' else {'queued':queue.enqueue(args.command, args.instance)}, indent=2))
