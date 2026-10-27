import tempfile
import unittest
import time
import uuid
from pathlib import Path
from queue_store import Queue, INSTANCE, validate_observation_result, write_payload

class QueueTests(unittest.TestCase):
    def test_combined_diary_requires_complete_content_on_both_sides(self):
        payload={'kind':'diary','film':'test','account':'prplmg','originEntityId':'local:1',
                 'expected':{'watchedDate':None,'rewatch':False,'rating':4,'text':'','spoiler':False},
                 'desired':{'watchedDate':'2026-10-21','rewatch':True,'rating':4.5,'text':'Review','spoiler':True}}
        write_payload(payload)
        del payload['expected']['rating']
        with self.assertRaises(ValueError): write_payload(payload)

    def test_read_pause_recovers_after_verified_identity_and_survives_restart(self):
        job=self.q.enqueue('identity_probe');self.q.claim(INSTANCE)
        self.q.event(INSTANCE,job,{'outcome':'blocked','error':'page-not-ready'},True)
        self.q.db.close();self.q=Queue(self.path)
        recovery=self.q.enqueue('identity_probe');self.q.claim(INSTANCE)
        self.q.event(INSTANCE,recovery,{'outcome':'succeeded','identity':'prplmg'},True)
        self.assertEqual(self.q.db.execute('SELECT paused FROM accounts WHERE instance=?',(INSTANCE,)).fetchone()[0],0)
        self.assertEqual(self.q.db.execute('SELECT state FROM jobs WHERE id=?',(job,)).fetchone()[0],'blocked')

    def test_identity_does_not_clear_legacy_or_mutating_pause(self):
        instance,payload=self.write_setup()
        job=self.q.enqueue('media_write',instance,payload=payload);self.q.claim(instance)
        self.q.event(instance,job,{'outcome':'unknown'},True)
        read=self.q.enqueue('identity_probe',instance);self.q.claim(instance)
        self.q.event(instance,read,{'outcome':'blocked'},True)
        recovery=self.q.enqueue('identity_probe',instance);self.q.claim(instance)
        self.q.event(instance,recovery,{'outcome':'succeeded','identity':'prplmg'},True)
        self.assertEqual(self.q.db.execute('SELECT paused FROM accounts WHERE instance=?',(instance,)).fetchone()[0],1)

    def test_wrong_identity_cannot_clear_read_pause(self):
        job=self.q.enqueue('identity_probe');self.q.claim(INSTANCE)
        self.q.event(INSTANCE,job,{'outcome':'blocked'},True)
        recovery=self.q.enqueue('identity_probe');self.q.claim(INSTANCE)
        self.q.event(INSTANCE,recovery,{'outcome':'succeeded','identity':'other'},True)
        self.assertEqual(self.q.db.execute('SELECT paused FROM accounts WHERE instance=?',(INSTANCE,)).fetchone()[0],1)

    def test_late_durable_result_after_watchdog_is_accepted_without_reexecution(self):
        job=self.q.enqueue('identity_probe');self.q.offer(INSTANCE);token=str(uuid.uuid4());self.q.start(INSTANCE,job,token)
        self.q.event(INSTANCE,job,{'stage':'opened-pilot-tab'},False,token)
        self.q.db.execute('UPDATE jobs SET claimed=0 WHERE id=?',(job,));self.q.db.commit();self.q.expire()
        self.assertIsNone(self.q.offer(INSTANCE))
        self.q.event(INSTANCE,job,{'outcome':'succeeded','identity':'prplmg'},True,token)
        self.assertEqual(self.q.db.execute('SELECT state FROM jobs WHERE id=?',(job,)).fetchone()[0],'succeeded')
        self.assertIsNone(self.q.offer(INSTANCE))
    def test_lost_offer_and_ack_survive_restart_without_duplicate_execution(self):
        job=self.q.enqueue('identity_probe');offer=self.q.offer(INSTANCE)
        self.q.db.close();self.q=Queue(self.path)
        self.assertEqual(self.q.offer(INSTANCE),offer)
        execution=str(uuid.uuid4())
        self.assertTrue(self.q.start(INSTANCE,job,execution))
        self.assertTrue(self.q.start(INSTANCE,job,execution))
        self.assertFalse(self.q.start(INSTANCE,job,str(uuid.uuid4())))
        self.assertIsNone(self.q.offer(INSTANCE))
        payload={'outcome':'succeeded','identity':'prplmg'}
        self.q.event(INSTANCE,job,payload,True,execution)
        self.q.event(INSTANCE,job,payload,True,execution)
        self.assertEqual(self.q.db.execute('SELECT COUNT(*) FROM events WHERE job=?',(job,)).fetchone()[0],1)

    def test_lost_start_response_reoffers_but_rejects_delayed_old_executor(self):
        job=self.q.enqueue('identity_probe');self.q.offer(INSTANCE)
        old=str(uuid.uuid4());self.q.start(INSTANCE,job,old)
        self.q.db.execute('UPDATE jobs SET claimed=0 WHERE id=?',(job,));self.q.db.commit();self.q.expire()
        self.assertEqual(self.q.offer(INSTANCE)['id'],job)
        new=str(uuid.uuid4());self.assertTrue(self.q.start(INSTANCE,job,new))
        with self.assertRaises(ValueError):self.q.event(INSTANCE,job,{'stage':'opened-pilot-tab'},False,old)
        self.q.event(INSTANCE,job,{'stage':'opened-pilot-tab'},False,new)
        self.q.db.execute('UPDATE jobs SET claimed=0 WHERE id=?',(job,));self.q.db.commit();self.q.expire()
        self.assertIsNone(self.q.offer(INSTANCE))
        self.assertEqual(self.q.db.execute('SELECT state FROM jobs WHERE id=?',(job,)).fetchone()[0],'unknown')

    def test_history_probe_requires_identity_and_is_read_only_while_paused(self):
        with self.assertRaises(ValueError):
            self.q.enqueue('review_history_probe')
        identity=self.q.enqueue('identity_probe');self.q.claim(INSTANCE)
        self.q.event(INSTANCE,identity,{'outcome':'succeeded','identity':'prplmg'},True)
        self.q.db.execute('UPDATE accounts SET paused=1 WHERE instance=?',(INSTANCE,));self.q.db.commit()
        job=self.q.enqueue('review_history_probe')
        self.assertEqual(self.q.claim(INSTANCE)['id'],job)
        self.q.event(INSTANCE,job,{'outcome':'succeeded','identity':'prplmg'},True)
        self.assertEqual(self.q.db.execute('SELECT paused FROM accounts WHERE instance=?',(INSTANCE,)).fetchone()[0],1)
        self.assertEqual(self.q.db.execute('SELECT COUNT(*) FROM write_payloads').fetchone()[0],0)
    def test_diary_dates_must_match_inventory_and_real_calendar_dates(self):
        intent={'userId':1,'account':'prplmg','film':'jaws','claimedAt':100}
        entry='https://letterboxd.com/prplmg/film/jaws/2/'
        observation={'rating':None,'text':'','spoiler':False,'observedAt':101,
                     'watched':True,'diaryEntriesComplete':True,'diaryEntryIds':[entry]}
        result={'identity':'prplmg','complete':True,'observationStatus':'verified'}
        invalid=[None,[],{}, {'other':'2026-10-18'}]
        invalid += [{entry:value} for value in ('2026-02-30','2026-2-01','0000-01-01','2026-10-18T00:00:00Z',None)]
        for dates in invalid:
            with self.subTest(dates=dates), self.assertRaises(ValueError):
                validate_observation_result(intent,{**result,'observation':{**observation,'diaryEntryDates':dates}})
        validate_observation_result(intent,{**result,'observation':{**observation,'diaryEntryDates':{entry:'2024-02-29'}}})
        with self.assertRaises(ValueError):
            validate_observation_result(intent,{**result,'observation':{'rating':None,'text':'','spoiler':False,'observedAt':101,'diaryEntryDates':{}}})
    def test_playback_observation_validation_and_legacy_absence(self):
        intent={'userId':1,'account':'prplmg','film':'jaws','claimedAt':100}
        observation={'rating':None,'text':'','spoiler':False,'observedAt':101}
        result={'identity':'prplmg','complete':True,'observationStatus':'verified','observation':observation}
        validate_observation_result(intent,result)
        self.assertNotIn('watched',observation)
        self.assertNotIn('diaryEntryIds',observation)
        entry='https://letterboxd.com/prplmg/film/jaws/2/'
        for complete in (False,True):
            validate_observation_result(intent,{**result,'observation':{**observation,'watched':False,'diaryEntriesComplete':complete,'diaryEntryIds':[]}})
        validate_observation_result(intent,{**result,'observation':{**observation,'watched':True,'diaryEntriesComplete':True,'diaryEntryIds':[entry]}})
        invalid=[{'watched':v} for v in (None,0,1,'false')]
        invalid += [{'diaryEntriesComplete':True},{'diaryEntryIds':[]}]
        invalid += [{'diaryEntriesComplete':v,'diaryEntryIds':[]} for v in (None,1,'true')]
        invalid += [{'diaryEntriesComplete':True,'diaryEntryIds':v} for v in
                    (None,{},[entry,entry],[None],['https://letterboxd.com/other/film/jaws/'],
                     ['https://letterboxd.com/prplmg/film/other/'],[entry+'?page=1'],
                     [f'https://letterboxd.com/prplmg/film/jaws/{i+1}/' for i in range(1001)])]
        for patch in invalid:
            with self.subTest(patch=repr(patch)[:100]), self.assertRaises(ValueError):
                validate_observation_result(intent,{**result,'observation':{**observation,**patch}})

    def test_playback_observation_evidence_survives_queue_restart(self):
        instance,_=self.write_setup()
        payload={'userId':1,'account':'prplmg','film':'jaws','claimToken':str(uuid.uuid4()),'claimedAt':time.time()*1000}
        job=self.q.enqueue('review_observe',instance,payload=payload)
        self.q.claim(instance)
        observation={'rating':None,'text':'','spoiler':False,'observedAt':time.time()*1000,
                     'watched':False,'diaryEntriesComplete':True,'diaryEntryIds':[],'diaryEntryDates':{}}
        self.q.event(instance,job,{'outcome':'succeeded','observationStatus':'verified','identity':'prplmg','complete':True,'observation':observation},True)
        self.q.db.close();self.q=Queue(self.path)
        import json
        stored=json.loads(self.q.db.execute('SELECT result FROM jobs WHERE id=?',(job,)).fetchone()[0])
        self.assertEqual(stored['observation'],observation)

    def test_observation_complete_scoped_results_survive_restart(self):
        instance,_=self.write_setup()
        payload={'userId':1,'account':'prplmg','film':'jaws','claimToken':str(uuid.uuid4()),'claimedAt':time.time()*1000}
        job=self.q.enqueue('review_observe',instance,str(uuid.uuid4()),payload)
        self.q.db.close();self.q=Queue(self.path)
        self.assertEqual(self.q.claim(instance)['claimToken'],payload['claimToken'])
        result={'outcome':'succeeded','observationStatus':'verified','identity':'prplmg','complete':True,
                'observation':{'rating':None,'text':'','spoiler':False,'observedAt':time.time()*1000}}
        for change in ({'identity':'other'},{'complete':False},{'observationStatus':'unknown'},
                       {'observation':{**result['observation'],'text':'unidentified review'}},
                       {'observation':{**result['observation'],'entryId':'https://letterboxd.com/other/film/jaws/'}}):
            with self.assertRaises(ValueError):self.q.event(instance,job,{**result,**change},True)
        self.q.event(instance,job,result,True)
        self.assertEqual(self.q.enqueue('review_observe',instance,job,payload),job)
        with self.assertRaises(ValueError):self.q.enqueue('review_observe',instance,job,{**payload,'film':'other'})
    def test_observation_requires_bound_account_and_rejects_incomplete_payload(self):
        instance,_=self.write_setup()
        payload={'userId':1,'account':'prplmg','film':'jaws','claimToken':str(uuid.uuid4()),'claimedAt':time.time()*1000}
        for change in ({'userId':0},{'account':'other'},{'film':'../jaws'},{'entryId':'https://letterboxd.com/prplmg/film/other/'},{'claimToken':'bad'}):
            with self.assertRaises(ValueError):self.q.enqueue('review_observe',instance,payload={**payload,**change})
        with self.assertRaises(ValueError):self.q.enqueue('review_observe',str(uuid.uuid4()),payload=payload)
    def test_ambiguous_observation_pauses_without_fabricating_baseline(self):
        instance,_=self.write_setup()
        payload={'userId':1,'account':'prplmg','film':'jaws','claimToken':str(uuid.uuid4()),'claimedAt':time.time()*1000}
        job=self.q.enqueue('review_observe',instance,payload=payload);self.q.claim(instance)
        self.q.event(instance,job,{'outcome':'blocked','observationStatus':'ambiguous','identity':'prplmg','complete':False},True)
        self.assertEqual(self.q.db.execute('SELECT paused FROM accounts WHERE instance=?',(instance,)).fetchone()[0],1)
        cleanup=self.q.enqueue('cleanup_tabs',instance)
        self.assertEqual(self.q.claim(instance)['id'],cleanup)
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.path=Path(self.tmp.name)/'queue.sqlite'
        self.q=Queue(self.path)
    def tearDown(self):
        self.q.db.close()
        self.tmp.cleanup()
    def write_setup(self, kind='review'):
        instance='6e282ef9-86a2-4356-9387-16f99807e283'
        self.q.db.execute('INSERT INTO accounts VALUES(?,?,0)',(instance,'prplmg'));self.q.db.commit()
        probe=self.q.enqueue('identity_probe',instance);self.q.claim(instance)
        self.q.event(instance,probe,{'outcome':'succeeded','identity':'prplmg'},True)
        values={'rating':{'rating':4},'review':{'rating':4,'text':'hello','spoiler':True},'watched':{'watched':True},'diary':{'watchedDate':'2026-10-18','rewatch':False}}[kind]
        return instance, {'userId':1,'account':'prplmg','film':'jaws','kind':kind,'originEntityId':'local-1','expected':values,'desired':values}
    def test_all_media_kinds_survive_restart_and_keep_identity(self):
        for kind in ('rating','review','watched','diary'):
            with self.subTest(kind=kind):
                if kind != 'rating':
                    self.q.db.execute("DELETE FROM accounts WHERE instance != ?",(INSTANCE,));self.q.db.commit()
                instance,payload=self.write_setup(kind)
                job=self.q.enqueue('media_write',instance,str(uuid.uuid4()),payload)
                self.q.db.close();self.q=Queue(self.path)
                claimed=self.q.claim(instance)
                self.assertEqual(claimed['originEntityId'],'local-1')
                self.assertEqual(claimed['kind'],kind)
                result={'outcome':'succeeded','identity':'prplmg','values':payload['desired']}
                if kind in ('review','diary'):
                    with self.assertRaises(ValueError):self.q.event(instance,job,result,True)
                    result['entryId']='https://letterboxd.com/prplmg/film/jaws/2/'
                self.q.event(instance,job,result,True)
                self.assertIsNone(self.q.claim(instance))
                self.assertEqual(self.q.enqueue('media_write',instance,job,payload),job)
                with self.assertRaises(ValueError):self.q.enqueue('media_write',instance,job,{**payload,'originEntityId':'different'})
    def test_watchlist_is_rejected_even_when_previously_queued(self):
        with self.assertRaises(ValueError):self.q.enqueue('watchlist_set')
        instance,payload=self.write_setup()
        with self.assertRaises(ValueError):self.q.enqueue('media_write',instance,payload={**payload,'kind':'watchlist'})
        self.q.db.execute("INSERT INTO jobs VALUES(?,?,?,'queued',?,NULL,NULL)",(str(uuid.uuid4()),instance,'watchlist_set',time.time()));self.q.db.commit()
        self.assertIsNone(self.q.claim(instance))
        self.assertEqual(self.q.db.execute('SELECT paused FROM accounts WHERE instance=?',(instance,)).fetchone()[0],1)
    def test_wrong_entry_cannot_ack_and_invalid_values_cannot_enqueue(self):
        instance,payload=self.write_setup()
        for extra in ({'desired':{'rating':True,'text':'x','spoiler':False}}, {'entryId':'https://letterboxd.com/other/film/jaws/'}, {'kind':'diary','expected':{'watchedDate':None,'rewatch':False},'desired':{'watchedDate':'2026-02-30','rewatch':False}}):
            with self.assertRaises(ValueError):self.q.enqueue('media_write',instance,payload={**payload,**extra})
        job=self.q.enqueue('media_write',instance,payload=payload);self.q.claim(instance)
        with self.assertRaises(ValueError):self.q.event(instance,job,{'outcome':'succeeded','identity':'prplmg','values':payload['desired'],'entryId':'https://letterboxd.com/prplmg/film/other/'},True)
    def succeed_identity(self):
        job=self.q.enqueue('identity_probe'); self.q.claim(INSTANCE)
        self.q.event(INSTANCE,job,{'outcome':'succeeded','identity':'prplmg'},True)
        return job
    def test_other_instance_cannot_claim(self):
        self.q.enqueue('identity_probe')
        self.assertIsNone(self.q.claim('other'))
        self.assertIsNotNone(self.q.claim(INSTANCE))
    def test_claim_not_redelivered(self):
        self.q.enqueue('identity_probe'); self.q.claim(INSTANCE)
        self.assertIsNone(self.q.claim(INSTANCE))
    def test_claim_survives_restart(self):
        self.q.enqueue('identity_probe'); self.q.claim(INSTANCE)
        self.q.db.close(); self.q=Queue(self.path)
        self.assertIsNone(self.q.claim(INSTANCE))
    def test_only_one_pending_job(self):
        self.q.enqueue('identity_probe')
        with self.assertRaises(ValueError):self.q.enqueue('identity_probe')
    def test_missing_identity_blocks_watchlist(self):
        with self.assertRaises(ValueError):self.q.enqueue('watchlist_probe')
        with self.assertRaises(ValueError):self.q.enqueue('watchlist_cycle')
    def test_missing_watchlist_probe_blocks_cycle(self):
        self.succeed_identity()
        with self.assertRaises(ValueError):self.q.enqueue('watchlist_cycle')
        self.assertTrue(self.q.enqueue('watchlist_probe'))
    def test_readonly_export_requires_identity_not_watchlist_pilot(self):
        with self.assertRaises(ValueError): self.q.enqueue('export_scan')
        self.succeed_identity()
        self.assertTrue(self.q.enqueue('export_scan'))
    def test_wrong_instance_cannot_report(self):
        job=self.q.enqueue('identity_probe');self.q.claim(INSTANCE)
        with self.assertRaises(ValueError):self.q.event('other',job,{'outcome':'succeeded'},True)

    def test_readonly_scans_can_run_during_pause_without_resuming_writes(self):
        self.succeed_identity()
        self.q.db.execute('UPDATE accounts SET paused=1 WHERE instance=?',(INSTANCE,))
        self.q.db.commit()
        for action in ('export_scan','watchlist_scan'):
            job=self.q.enqueue(action)
            self.assertEqual(self.q.claim(INSTANCE)['id'],job)
            self.q.event(INSTANCE,job,{'outcome':'blocked','error':'challenge'},True)
            self.assertEqual(self.q.db.execute('SELECT paused FROM accounts WHERE instance=?',(INSTANCE,)).fetchone()[0],1)
        with self.assertRaises(ValueError):self.q.enqueue('watchlist_cycle')

    def test_export_success_does_not_clear_uncertain_write(self):
        instance,payload=self.write_setup()
        write=self.q.enqueue('media_write',instance,payload=payload);self.q.claim(instance)
        self.q.event(instance,write,{'outcome':'unknown'},True)
        job=self.q.enqueue('export_scan',instance);self.q.claim(instance)
        self.q.event(instance,job,{'outcome':'succeeded','complete':True,'identity':'prplmg','encoded':'UEs=','capturedAt':time.time()*1000},True)
        self.assertEqual(self.q.db.execute('SELECT state FROM jobs WHERE id=?',(write,)).fetchone()[0],'unknown')
        self.assertEqual(self.q.db.execute('SELECT paused FROM accounts WHERE instance=?',(instance,)).fetchone()[0],1)

    def test_paused_export_still_requires_identity_probe(self):
        self.q.db.execute('UPDATE accounts SET paused=1 WHERE instance=?',(INSTANCE,));self.q.db.commit()
        with self.assertRaises(ValueError):self.q.enqueue('export_scan')
    def test_failure_pauses_account(self):
        job=self.q.enqueue('identity_probe');self.q.claim(INSTANCE)
        self.q.event(INSTANCE,job,{'outcome':'blocked','error':'challenge'},True)
        with self.assertRaises(ValueError):self.q.enqueue('watchlist_cycle')
    def test_timeout_is_unknown_not_retry(self):
        job=self.q.enqueue('identity_probe');self.q.claim(INSTANCE)
        self.q.db.execute('UPDATE jobs SET claimed=0 WHERE id=?',(job,));self.q.db.commit()
        self.assertIsNone(self.q.claim(INSTANCE))
        self.assertEqual(self.q.status()['jobs'][0]['state'],'unknown')
        self.assertEqual(self.q.status()['accounts'][0]['paused'],1)
    def test_active_progress_extends_scan_lease(self):
        job=self.q.enqueue('identity_probe');self.q.claim(INSTANCE)
        self.q.db.execute('UPDATE jobs SET claimed=? WHERE id=?',(time.time()-200,job));self.q.db.commit()
        self.q.event(INSTANCE,job,{'stage':'opened-pilot-tab','tabId':1})
        self.q.expire()
        self.assertEqual(self.q.status()['jobs'][0]['state'],'running')
    def test_progress_cannot_extend_a_job_forever(self):
        job=self.q.enqueue('identity_probe');self.q.claim(INSTANCE)
        self.q.db.execute('UPDATE jobs SET claimed=? WHERE id=?',(time.time()-3601,job));self.q.db.commit()
        self.q.event(INSTANCE,job,{'stage':'opened-pilot-tab','tabId':1})
        self.q.expire()
        self.assertEqual(self.q.status()['jobs'][0]['state'],'unknown')
    def test_no_secret_fields(self):
        job=self.q.enqueue('identity_probe');self.q.claim(INSTANCE)
        with self.assertRaises(ValueError):self.q.event(INSTANCE,job,{'cookie':'secret'})
    def test_terminal_job_cannot_be_overwritten(self):
        job=self.succeed_identity()
        with self.assertRaises(ValueError):self.q.event(INSTANCE,job,{'outcome':'unknown'},True)
    def test_original_state_persists(self):
        job=self.q.enqueue('identity_probe');self.q.claim(INSTANCE)
        self.q.event(INSTANCE,job,{'stage':'before-test-change','original':False})
        self.q.db.close();self.q=Queue(self.path)
        self.assertIn('"original": false',self.q.status()['events'][0]['payload'])
    def test_complete_snapshot_is_saved_atomically(self):
        self.succeed_identity()
        job=self.q.enqueue('watchlist_scan');self.q.claim(INSTANCE)
        self.q.event(INSTANCE,job,{'stage':'watchlist-snapshot','outcome':'succeeded','identity':'prplmg','complete':True,'items':[{'slug':'jaws','title':'Jaws'}]},True)
        row=self.q.db.execute('SELECT * FROM watchlist_snapshots').fetchone()
        self.assertEqual(row['job'],job)
        self.assertEqual(self.q.status()['jobs'][-1]['state'],'succeeded')
    def test_incomplete_snapshot_preserves_last_good(self):
        self.test_complete_snapshot_is_saved_atomically()
        job=self.q.enqueue('watchlist_scan');self.q.claim(INSTANCE)
        with self.assertRaises(ValueError):self.q.event(INSTANCE,job,{'stage':'watchlist-snapshot','outcome':'succeeded','identity':'prplmg','complete':False,'items':[]},True)
        self.assertIn('jaws',self.q.db.execute('SELECT items FROM watchlist_snapshots').fetchone()[0])
    def test_snapshot_rejects_wrong_identity_or_duplicate(self):
        self.succeed_identity()
        job=self.q.enqueue('watchlist_scan');self.q.claim(INSTANCE)
        payload={'stage':'watchlist-snapshot','outcome':'succeeded','identity':'wrong','complete':True,'items':[{'slug':'jaws','title':'Jaws'}]}
        with self.assertRaises(ValueError):self.q.event(INSTANCE,job,payload,True)
        payload['identity']='prplmg';payload['items']*=2
        with self.assertRaises(ValueError):self.q.event(INSTANCE,job,payload,True)

    def test_paused_account_allows_read_only_reconciliation_but_stays_paused(self):
        self.succeed_identity()
        self.q.db.execute('UPDATE accounts SET paused=1 WHERE instance=?',(INSTANCE,));self.q.db.commit()
        job=self.q.enqueue('review_probe');self.assertEqual(self.q.claim(INSTANCE)['id'],job)
        self.q.event(INSTANCE,job,{'outcome':'succeeded','identity':'prplmg'},True)
        self.assertEqual(self.q.db.execute('SELECT paused FROM accounts WHERE instance=?',(INSTANCE,)).fetchone()[0],1)
        scan=self.q.enqueue('watchlist_scan')
        self.assertEqual(self.q.claim(INSTANCE)['id'],scan)
        self.q.event(INSTANCE,scan,{'stage':'watchlist-snapshot','outcome':'succeeded','complete':True,'identity':'prplmg','items':[]},True)
        self.assertEqual(self.q.db.execute('SELECT paused FROM accounts WHERE instance=?',(INSTANCE,)).fetchone()[0],1)

if __name__=='__main__':unittest.main()
