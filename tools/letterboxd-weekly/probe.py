"""Bounded read-only live adapter test. Does not import catalogue lists."""
import json,sqlite3,sys,time,uuid
from pathlib import Path
root=Path('C:/Users/MSI/MultimeldiaLetterboxdRuntime');sys.path.insert(0,str(root))
from queue_store import Queue
q=Queue(root/'queue.sqlite');config=json.loads((root/'catalogue.json').read_text())
versions=json.loads((root/'worker-versions.json').read_text())
instances=[i for i in config['instances'] if versions.get(i,{}).get('version')=='0.2.49' and versions[i].get('inPrivateAllowed') is True]
instances=[i for i in instances if not q.db.execute("SELECT 1 FROM jobs WHERE instance=? AND state IN ('queued','running','offered')",(i,)).fetchone()]
if not instances:raise RuntimeError('No idle verified new adapter; no test enqueued')
instance=instances[0]
pages=['https://letterboxd.com/lists/popular/'+c+p for c in ('','this/week/','this/month/','this/year/') for p in ('','page/2/')]
results=[]
for url in pages:
    begin=time.monotonic();job=q.enqueue('list_scan',instance,payload={'url':url,'token':str(uuid.uuid4()),'mode':'discovery','maxFilms':560})
    # Diagnostic jobs have no server claim. Exclude delivery before they complete.
    with q.db:q.db.execute('INSERT OR IGNORE INTO list_acks VALUES(?)',(job,))
    while time.monotonic()-begin<90:
        row=q.db.execute('SELECT state,result FROM jobs WHERE id=?',(job,)).fetchone()
        if row['state'] in ('succeeded','blocked','unknown'):break
        time.sleep(1)
    result=json.loads(row['result'] or '{}');snapshot=result.get('snapshot',{})
    summary={'url':url,'state':row['state'],'seconds':round(time.monotonic()-begin,3),'count':len(snapshot.get('candidates',[])),'error':result.get('error')}
    print(json.dumps(summary),flush=True);results.append({'summary':summary,'snapshot':snapshot})
    if row['state']!='succeeded':break
file=root/'weekly-lists-stage-20261106'/'probe-results.json';file.write_text(json.dumps(results,indent=2))
if len(results)!=8 or any(r['summary']['state']!='succeeded' for r in results):raise RuntimeError('Discovery probe incomplete; inspect saved evidence')
unique={c['url']:c for r in results for c in r['snapshot']['candidates']}
eligible=[c for c in unique.values() if 0<c['total']<=560]
print(json.dumps({'pages':8,'uniqueLists':len(unique),'eligible':len(eligible),'memberships':sum(c['total'] for c in eligible),'seconds':sum(r['summary']['seconds'] for r in results),'catalogueWrites':0}),flush=True)
