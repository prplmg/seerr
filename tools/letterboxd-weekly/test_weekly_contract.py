import unittest, tempfile, uuid
from pathlib import Path
from queue_store import Queue, INSTANCE, list_payload
class WeeklyContract(unittest.TestCase):
    def test_census_round_trip_and_no_account_pause(self):
        with tempfile.TemporaryDirectory() as temp:
            q=Queue(Path(temp)/'q.sqlite')
            payload={'url':'https://letterboxd.com/lists/popular/this/week/page/2/','mode':'discovery','maxFilms':560,'token':str(uuid.uuid4())}
            job=q.enqueue('list_scan',payload=payload)
            claim=q.claim(INSTANCE)
            self.assertEqual(claim['mode'],'discovery');self.assertEqual(claim['maxFilms'],560)
            q.event(INSTANCE,job,{'outcome':'succeeded','snapshot':{'url':payload['url'],'anonymous':True,'complete':True,'candidates':[{'url':'https://letterboxd.com/a/list/test/','title':'Test','total':560}]}},True)
            self.assertEqual(q.db.execute('SELECT paused FROM accounts').fetchone()[0],0)
            q.db.close()
    def test_strict_modes_caps_and_pages(self):
        base={'url':'https://letterboxd.com/lists/popular/','mode':'discovery','maxFilms':560,'token':str(uuid.uuid4())}
        for edit in [{'url':'https://letterboxd.com/settings/'},{'url':'https://letterboxd.com/lists/popular/page/3/'},{'maxFilms':561},{'mode':'write'},{'maxFilms':True}]:
            with self.assertRaises(ValueError):list_payload({**base,**edit})
