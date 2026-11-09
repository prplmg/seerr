"""Account-bound browser worker. Loopback only; pilot writes restricted to prplmg."""
import json
import secrets
import time
import uuid
import threading
from queue import SimpleQueue
from pathlib import Path
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlsplit, parse_qs
from queue_store import Queue
from catalogue_client import CatalogueClient
from browser_launcher import start_launcher

root = Path(__file__).resolve().parent
extension_root = root.parent / 'MultimeldiaLetterboxdPilot' if root.name == 'MultimeldiaLetterboxdRuntime' else root
config = extension_root / 'config.js'
if not config.exists():
    config.write_text('const PILOT_TOKEN = ' + json.dumps(secrets.token_urlsafe(32)) + ';\n')
token = json.loads(config.read_text().split('=', 1)[1].strip().rstrip(';'))
result_path = root / 'result.json'
reports_path = root / 'reports.json'
reports = json.loads(reports_path.read_text()) if reports_path.exists() else {}
pilot_instance = '7cb664cd-13ca-4d8e-ae8a-c3882547643c'
issued_path = root / 'fresh-read-issued.json'
deadline = time.monotonic() + 1800
queue = Queue(root / 'queue.sqlite')
catalogue = CatalogueClient(queue, root / 'catalogue.json')
refreshed_instances = set()
exchanges = SimpleQueue()
pending_exchanges = set()
dirty_exchanges = set()
last_exchange = {}
exchange_lock = threading.Lock()
def schedule_exchange(instance, again=False):
    with exchange_lock:
        if instance in pending_exchanges:
            if again:dirty_exchanges.add(instance)
        else:
            if not again and time.monotonic()-last_exchange.get(instance,0)<10:return
            last_exchange[instance]=time.monotonic()
            pending_exchanges.add(instance)
            exchanges.put(instance)
def exchange_loop():
    client=CatalogueClient(Queue(root / 'queue.sqlite'), root / 'catalogue.json')
    while True:
        instance=exchanges.get()
        try:
            failures = client.exchange_cycle(instance)
            with exchange_lock:(root / 'catalogue-health.json').write_text(json.dumps({
                'checkedAt': time.time(), 'instance': instance,
                'healthy': not failures, 'failures': failures,
            }))
        except Exception:
            with exchange_lock:(root / 'catalogue-health.json').write_text(json.dumps({'failedAt':time.time(),'error':'Catalogue exchange unavailable'}))
        finally:
            with exchange_lock:
                if instance in dirty_exchanges:
                    dirty_exchanges.discard(instance)
                    exchanges.put(instance)
                else:pending_exchanges.discard(instance)
# At most two profiles exchange concurrently; pending_exchanges still serializes each profile.
for worker in range(2):
    threading.Thread(target=exchange_loop,daemon=True,name='catalogue-exchange-'+str(worker)).start()

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass
    def reply(self, status, value):
        payload = json.dumps(value).encode()
        try:
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        except (ConnectionError, BrokenPipeError):
            # Delivery is acknowledged separately; never undo a claim or replay a write.
            self.close_connection = True
    def authorized(self):
        return secrets.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + token)
    def do_GET(self):
        if not self.authorized():
            return self.reply(403, {})
        url = urlsplit(self.path)
        if url.path == '/queue':
            instance = parse_qs(url.query).get('instance', [''])[0]
            try:
                instance = str(uuid.UUID(instance))
            except ValueError:
                return self.reply(400, {})
            polls_path = root / 'worker-polls.json'
            from telemetry_state import read_telemetry, write_telemetry
            polls = read_telemetry(polls_path)
            if instance in polls or len(polls) < 20:
                polls[instance] = time.time()
                write_telemetry(polls_path, polls)
            versions_path = root / 'worker-versions.json'
            versions = read_telemetry(versions_path)
            if instance in polls:
                versions[instance] = {'version': parse_qs(url.query).get('version', [''])[0][:32], 'seenAt': time.time(), 'inPrivateAllowed':parse_qs(url.query).get('inPrivateAllowed')==['true']}
                write_telemetry(versions_path, versions)
            if instance not in refreshed_instances:
                refreshed_instances.add(instance)
                return self.reply(200, {'action':'reload-extension'})
            if parse_qs(url.query).get('version') != ['0.2.50']:
                return self.reply(200, {'action':'reload-extension'})
            # External requests must not delay the local delivery/acknowledgement path.
            schedule_exchange(instance)
            with exchange_lock:pending=instance in pending_exchanges
            return self.reply(200, queue.offer(instance) or {'action':'idle',**({'retryAfterMs':1000} if pending else {})})
        if url.path != '/job':
            return self.reply(404, {})
        query = parse_qs(url.query)
        if query.get('instance') == [pilot_instance] and query.get('version') == ['3'] and not issued_path.exists() and time.monotonic() < deadline:
            # Durable claim before delivery: uncertain outcomes are not silently retried.
            issued_path.write_text(json.dumps({'instance':pilot_instance, 'issuedAt':time.time()}))
            return self.reply(200, {'action':'fresh-read', 'id':'prplmg-settings-read-1'})
        self.reply(200, {'action': 'identity' if time.monotonic() < deadline else 'idle'})
    def do_POST(self):
        if not self.authorized():
            return self.reply(403, {})
        if self.path not in ('/result', '/queue/result', '/queue/start'):
            return self.reply(404, {})
        length = int(self.headers.get('Content-Length', '0'))
        if not 0 < length <= (15 * 1024 * 1024 if self.path == '/queue/result' else 8192):
            return self.reply(400, {})
        try:
            data = json.loads(self.rfile.read(length))
            if self.path == '/queue/start':
                return self.reply(200, {'started':queue.start(data['instance'],data['job'],data['execution'])})
            if self.path == '/queue/result':
                queue.event(data['instance'],data['job'],data['payload'],data.get('final') is True,data.get('execution'))
                if data.get('final') is True:
                    schedule_exchange(data['instance'], again=True)
                    action=queue.db.execute('SELECT action FROM jobs WHERE id=? AND instance=?',(data['job'],data['instance'])).fetchone()
                    if action and action['action']=='review_cleanup':
                        with queue.db:queue.db.execute('UPDATE accounts SET paused=1 WHERE instance=?',(data['instance'],))
                return self.reply(200, {'saved':True})
            if data.get('version') not in (2, 3):
                return self.reply(400, {})
            instance = str(uuid.UUID(data['instance']))
            if instance not in reports and len(reports) >= 20:
                return self.reply(400, {})
            reports[instance] = {**data, 'receivedAt': time.time()}
            if data.get('jobId') == 'prplmg-settings-read-1' and instance == pilot_instance:
                (root / 'fresh-read-result.json').write_text(json.dumps(reports[instance], indent=2))
            (root / 'reports.json').write_text(json.dumps(reports, indent=2))
            self.reply(200, {'saved': True})
        except (ValueError, TypeError, KeyError, AttributeError):
            self.reply(400, {})

start_launcher(root)
HTTPServer(('127.0.0.1', 18764), Handler).serve_forever()
