import json
import tempfile
import unittest
import uuid
import time
from unittest.mock import Mock, patch
from pathlib import Path
from queue_store import Queue, INSTANCE
from catalogue_client import CatalogueClient, CatalogueOriginConnection

class CatalogueClientTests(unittest.TestCase):
    def reconciliation_setup(self, acknowledged=True):
        instance,_,client=self.observation_setup(False)
        values={'rating':4,'text':'Saved review','spoiler':True}
        entry='https://letterboxd.com/prplmg/film/jaws/1/'
        intent={'userId':1,'account':'prplmg','film':'jaws','kind':'review',
                'originEntityId':'local:1','entryId':entry,'expected':values,'desired':values}
        ident=self.q.enqueue('media_write',instance,payload=intent)
        self.q.claim(instance)
        self.q.event(instance,ident,{'outcome':'unknown','writeOutcome':'unknown','identity':'prplmg'},True)
        if acknowledged:
            with self.q.db:self.q.db.execute('INSERT INTO write_acks VALUES(?)',(ident,))
        receipt={'id':ident,'values':values,'entryId':entry}
        client.request=Mock(return_value={'action':'idle','reconciled':[receipt],'resumeWrites':True})
        return instance,ident,client,receipt

    def assert_reconciliation_state(self, instance, ident, state='unknown', paused=1):
        self.assertEqual(self.q.db.execute('SELECT state FROM jobs WHERE id=?',(ident,)).fetchone()[0],state)
        self.assertEqual(self.q.db.execute('SELECT paused FROM accounts WHERE instance=?',(instance,)).fetchone()[0],paused)

    def test_paused_reconciliation_cadence_keeps_observations_independent(self):
        instance,ident,client,_=self.reconciliation_setup()
        config=json.loads(self.config.read_text())
        config['supportedObservations']=['review_observe']
        self.config.write_text(json.dumps(config))
        client.request=Mock(return_value={'action':'idle','reconciled':[],'resumeWrites':False})
        with patch('catalogue_client.time.monotonic',side_effect=[0,1,59.99,60]):
            for _ in range(4):client.exchange_writes(instance)
        writes=[call for call in client.request.call_args_list if call.kwargs.get('writes')]
        observations=[call for call in client.request.call_args_list if call.kwargs.get('observations')]
        self.assertEqual(len(writes),2);self.assertEqual(len(observations),4)
        self.assertTrue(all(call.args[1]['reconcileIds']==[ident] for call in writes))
        self.assert_reconciliation_state(instance,ident)
        # Another configured paused profile is due independently.
        with self.q.db:self.q.db.execute('UPDATE accounts SET paused=1 WHERE instance=?',(INSTANCE,))
        config['instances'].append(INSTANCE);config['accounts'][INSTANCE]='prplmg'
        self.config.write_text(json.dumps(config))
        client.reconcile_writes=Mock()
        with patch('catalogue_client.time.monotonic',return_value=61):
            client.exchange_writes(instance);client.exchange_writes(INSTANCE)
        client.reconcile_writes.assert_called_once_with(INSTANCE,'prplmg',config)

    def test_failed_reconciliation_is_throttled_without_suppressing_observations(self):
        instance,ident,client,_=self.reconciliation_setup()
        client.request=Mock(side_effect=OSError('lost response'))
        client.exchange_observations=Mock()
        with patch('catalogue_client.time.monotonic',side_effect=[0,59,60]):
            with self.assertRaises(OSError):client.exchange_writes(instance)
            client.exchange_writes(instance)
            with self.assertRaises(OSError):client.exchange_writes(instance)
        self.assertEqual(client.request.call_count,2)
        self.assertEqual(client.exchange_observations.call_count,3)
        self.assert_reconciliation_state(instance,ident)

    def restart_reconciliation_client(self):
        self.q.db.close()
        self.q=Queue(self.root/'queue.sqlite')
        return CatalogueClient(self.q,self.config)

    def test_pending_resume_survives_false_response_and_restart(self):
        instance,ident,client,receipt=self.reconciliation_setup()
        client.request=Mock(return_value={'action':'idle','reconciled':[receipt],'resumeWrites':False})
        client.exchange_writes(instance)
        self.assert_reconciliation_state(instance,ident,'succeeded',1)
        self.assertEqual(self.q.db.execute('SELECT id FROM write_resume_pending').fetchone()[0],ident)
        restarted=self.restart_reconciliation_client()
        restarted.request=Mock(return_value={'action':'idle','reconciled':[receipt],'resumeWrites':True})
        restarted.exchange_writes(instance)
        self.assertEqual(restarted.request.call_args.args[1]['reconcileIds'],[ident])
        self.assert_reconciliation_state(instance,ident,'succeeded',0)
        self.assertEqual(self.q.db.execute('SELECT count(*) FROM write_resume_pending').fetchone()[0],0)
        # A later manual pause cannot reuse receipts from the completed recovery.
        with self.q.db:self.q.db.execute('UPDATE accounts SET paused=1 WHERE instance=?',(instance,))
        restarted=self.restart_reconciliation_client();restarted.request=Mock()
        restarted.exchange_writes(instance);restarted.request.assert_not_called()

    def test_pending_resume_waits_for_local_holds_then_rechecks(self):
        instance,ident,client,receipt=self.reconciliation_setup()
        for hold in ('running','blocked','watchdog','read'):
            other=str(uuid.uuid4())
            with self.q.db:
                self.q.db.execute("UPDATE jobs SET state='unknown' WHERE id=?",(ident,))
                self.q.db.execute('UPDATE accounts SET paused=1 WHERE instance=?',(instance,))
                if hold in ('running','blocked'):
                    self.q.db.execute('INSERT INTO jobs VALUES(?,?,?,?,?,NULL,NULL)',(other,instance,'media_write',hold,time.time()))
                elif hold=='watchdog':self.q.db.execute('INSERT INTO watchdog_pauses VALUES(?,?)',(instance,time.time()))
                else:self.q.db.execute('INSERT INTO readonly_pauses VALUES(?,?)',(instance,ident))
            client=self.restart_reconciliation_client()
            client.request=Mock(return_value={'action':'idle','reconciled':[receipt],'resumeWrites':True})
            client.exchange_writes(instance)
            self.assert_reconciliation_state(instance,ident,'succeeded',1)
            self.assertEqual(self.q.db.execute('SELECT count(*) FROM write_resume_pending').fetchone()[0],1)
            with self.q.db:
                self.q.db.execute('DELETE FROM jobs WHERE id=?',(other,))
                self.q.db.execute('DELETE FROM watchdog_pauses WHERE instance=?',(instance,))
                self.q.db.execute('DELETE FROM readonly_pauses WHERE instance=?',(instance,))
            client=self.restart_reconciliation_client()
            client.request=Mock(return_value={'action':'idle','reconciled':[receipt],'resumeWrites':True})
            client.exchange_writes(instance)
            self.assert_reconciliation_state(instance,ident,'succeeded',0)
            self.assertEqual(self.q.db.execute('SELECT count(*) FROM write_resume_pending').fetchone()[0],0)

    def test_pending_resume_failures_and_mismatch_keep_durable_marker(self):
        instance,ident,client,receipt=self.reconciliation_setup()
        client.request=Mock(return_value={'action':'idle','reconciled':[receipt],'resumeWrites':False})
        client.exchange_writes(instance)
        for response,error in ((None,OSError),({'action':'idle','reconciled':[{**receipt,'values':{}}],'resumeWrites':True},ValueError)):
            client=self.restart_reconciliation_client()
            client.request=Mock(side_effect=OSError('lost response')) if response is None else Mock(return_value=response)
            with self.assertRaises(error):client.exchange_writes(instance)
            self.assert_reconciliation_state(instance,ident,'succeeded',1)
            self.assertEqual(self.q.db.execute('SELECT count(*) FROM write_resume_pending').fetchone()[0],1)
        client=self.restart_reconciliation_client()
        client.request=Mock(return_value={'action':'idle','reconciled':[receipt],'resumeWrites':True})
        client.exchange_writes(instance)
        self.assert_reconciliation_state(instance,ident,'succeeded',0)

    def test_pending_resume_is_scoped_and_does_not_repair_manual_only_account(self):
        instance,ident,client,receipt=self.reconciliation_setup()
        client.request=Mock(return_value={'action':'idle','reconciled':[receipt],'resumeWrites':False})
        client.exchange_writes(instance)
        # A different profile with a historically succeeded write has no resume
        # claim, even when it uses the same Letterboxd username.
        other=str(uuid.uuid4())
        with self.q.db:
            self.q.db.execute('UPDATE accounts SET paused=1 WHERE instance=?',(INSTANCE,))
            self.q.db.execute('INSERT INTO jobs VALUES(?,?,?,?,?,NULL,NULL)',(other,INSTANCE,'media_write','succeeded',time.time()))
            self.q.db.execute('INSERT INTO write_payloads SELECT ?,payload FROM write_payloads WHERE id=?',(other,ident))
            self.q.db.execute('INSERT INTO write_acks VALUES(?)',(other,))
        config=json.loads(self.config.read_text());config['instances'].append(INSTANCE);config['accounts'][INSTANCE]='prplmg'
        self.config.write_text(json.dumps(config))
        client=self.restart_reconciliation_client();client.request=Mock()
        client.exchange_writes(INSTANCE);client.request.assert_not_called()
        client.request=Mock(return_value={'action':'idle','reconciled':[receipt],'resumeWrites':True})
        client.exchange_writes(instance)
        self.assert_reconciliation_state(instance,ident,'succeeded',0)
        self.assertEqual(self.q.db.execute('SELECT paused FROM accounts WHERE instance=?',(INSTANCE,)).fetchone()[0],1)

    def test_reconciliation_fair_batches_survive_restart_and_failed_request(self):
        instance,ident,client,receipt=self.reconciliation_setup()
        ids=[ident]
        with self.q.db:
            for _ in range(24):
                other=str(uuid.uuid4());ids.append(other)
                self.q.db.execute('INSERT INTO jobs VALUES(?,?,?,?,?,NULL,NULL)',(other,instance,'media_write','unknown',time.time()))
                self.q.db.execute('INSERT INTO write_payloads SELECT ?,payload FROM write_payloads WHERE id=?',(other,ident))
                self.q.db.execute('INSERT INTO write_acks VALUES(?)',(other,))
        # First ten become pending; a lost second response must not prevent the
        # final five unknowns from being checked after another restart.
        batches=[]
        def respond(token,payload,**kwargs):
            batch=payload['reconcileIds'];batches.append(batch)
            self.assertLessEqual(len(batch),10)
            return {'action':'idle','reconciled':[{**receipt,'id':i} for i in batch],'resumeWrites':False}
        client.request=Mock(side_effect=respond);client.exchange_writes(instance)
        client=self.restart_reconciliation_client()
        def lost(token,payload,**kwargs):
            batches.append(payload['reconcileIds']);raise OSError('lost response')
        client.request=Mock(side_effect=lost)
        with self.assertRaises(OSError):client.exchange_writes(instance)
        client=self.restart_reconciliation_client();client.request=Mock(side_effect=respond)
        client.exchange_writes(instance)
        self.assertEqual(set().union(*map(set,batches)),set(ids))
        self.assertTrue(set(ids[-5:]) <= set(batches[-1]))
        # Continue until all unknowns are repaired, then ask for positive resume.
        for _ in range(3):
            client=self.restart_reconciliation_client();client.request=Mock(side_effect=respond)
            client.exchange_writes(instance)
        self.assertEqual(self.q.db.execute("SELECT count(*) FROM jobs WHERE instance=? AND state='unknown'",(instance,)).fetchone()[0],0)
        self.assertEqual(self.q.db.execute('SELECT count(*) FROM write_resume_pending').fetchone()[0],25)
        client=self.restart_reconciliation_client()
        def approve(token,payload,**kwargs):
            return {**respond(token,payload,**kwargs),'resumeWrites':True}
        client.request=Mock(side_effect=approve);client.exchange_writes(instance)
        self.assert_reconciliation_state(instance,ident,'succeeded',0)
        self.assertEqual(self.q.db.execute('SELECT count(*) FROM write_resume_pending').fetchone()[0],0)

    def test_reconciliation_after_ack_is_durable_and_never_dispatches(self):
        instance,ident,client,receipt=self.reconciliation_setup()
        client.exchange_writes(instance)
        sent=client.request.call_args.args[1]
        self.assertEqual(sent['reconcileIds'],[ident]);self.assertEqual(sent['supported'],[])
        self.assertEqual(sent['action'],'idle');self.assertNotIn('report',sent)
        self.assert_reconciliation_state(instance,ident,'succeeded',0)
        self.assertEqual(self.q.db.execute('SELECT count(*) FROM write_acks WHERE id=?',(ident,)).fetchone()[0],1)
        # Restart and replay of the read-only operation cannot alter or dispatch work.
        restarted=CatalogueClient(self.q,self.config);restarted.request=Mock()
        restarted.reconcile_writes(instance,'prplmg',json.loads(self.config.read_text()))
        restarted.request.assert_not_called()
        self.assertEqual(self.q.db.execute("SELECT count(*) FROM jobs WHERE action='media_write'").fetchone()[0],1)
        result=json.loads(self.q.db.execute('SELECT result FROM jobs WHERE id=?',(ident,)).fetchone()[0])
        self.assertEqual(result['values'],receipt['values']);self.assertEqual(result['entryId'],receipt['entryId'])

    def test_reconciliation_delivers_unknown_outcome_first(self):
        instance,ident,client,receipt=self.reconciliation_setup(False)
        client.request=Mock(return_value={'action':'idle'})
        client.exchange_writes(instance)
        self.assertEqual(client.request.call_args.args[1]['report']['outcome'],'unknown')
        self.assertNotIn('reconcileIds',client.request.call_args.args[1])
        client.request=Mock(return_value={'action':'idle','reconciled':[receipt],'resumeWrites':True})
        client.exchange_writes(instance)
        self.assert_reconciliation_state(instance,ident,'succeeded',0)

    def test_reconciliation_lost_response_and_server_failure_retry_after_restart(self):
        from urllib.error import HTTPError
        instance,ident,client,receipt=self.reconciliation_setup()
        for error in (OSError('lost response'),HTTPError('https://private',503,'offline',None,None)):
            client.last_attempt.clear()
            client.request=Mock(side_effect=error)
            with self.assertRaises(type(error)):client.exchange_writes(instance)
            self.assert_reconciliation_state(instance,ident)
        restarted=CatalogueClient(self.q,self.config)
        restarted.request=Mock(return_value={'action':'idle','reconciled':[receipt],'resumeWrites':True})
        restarted.exchange_writes(instance)
        self.assert_reconciliation_state(instance,ident,'succeeded',0)

    def test_reconciliation_rejects_mismatch_and_mutating_response_atomically(self):
        instance,ident,client,receipt=self.reconciliation_setup(False)
        # Direct receipt path also writes an acknowledgement atomically.
        for change in ({'id':str(uuid.uuid4())},{'values':{**receipt['values'],'rating':3}},
                       {'values':{**receipt['values'],'spoiler':1}},
                       {'entryId':'https://letterboxd.com/other/film/jaws/1/'},
                       {'entryId':'https://letterboxd.com/prplmg/film/jaws/2/'}, {'entryId':None}):
            client.request=Mock(return_value={'action':'idle','reconciled':[{**receipt,**change}],'resumeWrites':True})
            with self.assertRaises(ValueError):client.reconcile_writes(instance,'prplmg',json.loads(self.config.read_text()))
            self.assert_reconciliation_state(instance,ident)
        for response in ({'action':'media_write','reconciled':[receipt]},
                         {'action':'idle','reconciled':[receipt,receipt]},
                         {'action':'idle','reconciled':{}}, {'reconciled':[receipt]}):
            client.request=Mock(return_value=response)
            with self.assertRaises(ValueError):client.reconcile_writes(instance,'prplmg',json.loads(self.config.read_text()))
            self.assert_reconciliation_state(instance,ident)
        self.assertEqual(self.q.db.execute('SELECT count(*) FROM write_acks').fetchone()[0],0)
        with self.q.db:
            intent=json.loads(self.q.db.execute('SELECT payload FROM write_payloads WHERE id=?',(ident,)).fetchone()[0])
            intent['account']='other'
            self.q.db.execute('UPDATE write_payloads SET payload=? WHERE id=?',(json.dumps(intent),ident))
        client.request=Mock(return_value={'action':'idle','reconciled':[receipt],'resumeWrites':True})
        with self.assertRaises(ValueError):client.reconcile_writes(instance,'prplmg',json.loads(self.config.read_text()))
        self.assert_reconciliation_state(instance,ident)

    def test_reconciliation_needs_positive_resume_and_receipts(self):
        instance,ident,client,receipt=self.reconciliation_setup()
        client.request=Mock(return_value={'action':'idle','reconciled':[],'resumeWrites':True})
        client.exchange_writes(instance);self.assert_reconciliation_state(instance,ident)
        for positive in (False,None,1,'true'):
            client.last_attempt.clear()
            with self.q.db:self.q.db.execute("UPDATE jobs SET state='unknown' WHERE id=?",(ident,))
            client.request=Mock(return_value={'action':'idle','reconciled':[receipt],'resumeWrites':positive})
            client.exchange_writes(instance);self.assert_reconciliation_state(instance,ident,'succeeded',1)

    def test_reconciliation_preserves_all_local_holds(self):
        instance,ident,client,receipt=self.reconciliation_setup()
        for state in ('unknown','blocked','queued','offered','running'):
            client.last_attempt.clear()
            other=str(uuid.uuid4())
            with self.q.db:
                self.q.db.execute("UPDATE jobs SET state='unknown' WHERE id=?",(ident,))
                self.q.db.execute('INSERT INTO jobs VALUES(?,?,?,?,?,NULL,NULL)',(other,instance,'media_write',state,time.time()))
            client.exchange_writes(instance)
            self.assert_reconciliation_state(instance,ident,'succeeded',1)
            with self.q.db:self.q.db.execute('DELETE FROM jobs WHERE id=?',(other,))
        for table,value in (('watchdog_pauses',time.time()),('readonly_pauses',ident)):
            client.last_attempt.clear()
            with self.q.db:
                self.q.db.execute("UPDATE jobs SET state='unknown' WHERE id=?",(ident,))
                self.q.db.execute('INSERT INTO '+table+' VALUES(?,?)',(instance,value))
            client.exchange_writes(instance)
            self.assert_reconciliation_state(instance,ident,'succeeded',1)
            with self.q.db:self.q.db.execute('DELETE FROM '+table)

    def test_reconciliation_diary_and_rating_receipts_use_saved_values(self):
        instance,ident,client,receipt=self.reconciliation_setup(False)
        for kind,values,entry in (
            ('diary',{'watchedDate':'2026-11-08','rewatch':False},receipt['entryId']),
            ('rating',{'rating':4},None),
        ):
            intent={'userId':1,'account':'prplmg','film':'jaws','kind':kind,
                    'originEntityId':'local:1','expected':values,'desired':values}
            with self.q.db:
                self.q.db.execute("UPDATE jobs SET state='unknown' WHERE id=?",(ident,))
                self.q.db.execute('UPDATE write_payloads SET payload=? WHERE id=?',(json.dumps(intent),ident))
                self.q.db.execute('UPDATE accounts SET paused=1 WHERE instance=?',(instance,))
            client.request=Mock(return_value={'action':'idle','reconciled':[{'id':ident,'values':values,'entryId':entry}],'resumeWrites':True})
            client.reconcile_writes(instance,'prplmg',json.loads(self.config.read_text()))
            self.assert_reconciliation_state(instance,ident,'succeeded',0)
            self.assertEqual(self.q.db.execute('SELECT count(*) FROM write_acks WHERE id=?',(ident,)).fetchone()[0],1)

    def test_reconciliation_bad_second_receipt_rolls_back_first_and_ack(self):
        instance,ident,client,receipt=self.reconciliation_setup(False)
        other=str(uuid.uuid4())
        with self.q.db:
            self.q.db.execute('INSERT INTO jobs VALUES(?,?,?,?,?,NULL,NULL)',(other,instance,'media_write','unknown',time.time()))
            self.q.db.execute('INSERT INTO write_payloads SELECT ?,payload FROM write_payloads WHERE id=?',(other,ident))
        client.request=Mock(return_value={'action':'idle','reconciled':[receipt,{**receipt,'id':other,'values':{}}],'resumeWrites':True})
        with self.assertRaises(ValueError):client.reconcile_writes(instance,'prplmg',json.loads(self.config.read_text()))
        self.assert_reconciliation_state(instance,ident)
        self.assert_reconciliation_state(instance,other)
        self.assertEqual(self.q.db.execute('SELECT count(*) FROM write_resume_pending').fetchone()[0],0)
        self.assertEqual(self.q.db.execute('SELECT count(*) FROM write_acks').fetchone()[0],0)

    def test_reconciliation_manual_pause_without_uncertain_jobs_never_requests(self):
        instance,_,client=self.observation_setup(False)
        with self.q.db:self.q.db.execute('UPDATE accounts SET paused=1 WHERE instance=?',(instance,))
        client.exchange_writes(instance);client.request.assert_not_called()
        self.assertEqual(self.q.db.execute('SELECT paused FROM accounts WHERE instance=?',(instance,)).fetchone()[0],1)

    def test_reconciliation_bounded_to_ten_and_partial_batch_stays_paused(self):
        instance,ident,client,receipt=self.reconciliation_setup()
        with self.q.db:
            for _ in range(10):
                other=str(uuid.uuid4())
                self.q.db.execute('INSERT INTO jobs VALUES(?,?,?,?,?,NULL,NULL)',(other,instance,'media_write','unknown',time.time()))
                self.q.db.execute('INSERT INTO write_payloads SELECT ?,payload FROM write_payloads WHERE id=?',(other,ident))
                self.q.db.execute('INSERT INTO write_acks VALUES(?)',(other,))
        client.exchange_writes(instance)
        self.assertEqual(len(client.request.call_args.args[1]['reconcileIds']),10)
        self.assert_reconciliation_state(instance,ident,'succeeded',1)

    def test_watched_capability_requires_fresh_loaded_adapter(self):
        client=CatalogueClient(self.q,self.config)
        file=self.root/'worker-versions.json'
        self.assertNotIn('watched',client.supported_writes(INSTANCE))
        file.write_text(json.dumps({INSTANCE:{'version':'0.2.48','seenAt':time.time()}}))
        self.assertIn('watched',client.supported_writes(INSTANCE))
        file.write_text(json.dumps({INSTANCE:{'version':'0.2.48','seenAt':time.time()-601}}))
        self.assertNotIn('watched',client.supported_writes(INSTANCE))

    def test_read_pause_recovers_with_probe_not_write_and_never_overrides_manual_hold(self):
        client=CatalogueClient(self.q,self.config)
        probe=self.q.enqueue('identity_probe',INSTANCE)
        self.q.claim(INSTANCE)
        self.q.event(INSTANCE,probe,{'outcome':'blocked'},True)
        with self.q.db:self.q.db.execute("UPDATE jobs SET created=? WHERE action='identity_probe'",(time.time()-1000,))
        client.recover_read_pause(INSTANCE)
        self.assertEqual(self.q.db.execute("SELECT count(*) FROM jobs WHERE action='identity_probe'").fetchone()[0],3)
        client.recover_read_pause(INSTANCE)
        self.assertEqual(self.q.db.execute('SELECT count(*) FROM jobs').fetchone()[0],3)
        nextjob=self.q.claim(INSTANCE)
        self.q.event(INSTANCE,nextjob['id'],{'outcome':'succeeded','identity':'prplmg'},True)
        self.assertEqual(self.q.db.execute('SELECT paused FROM accounts WHERE instance=?',(INSTANCE,)).fetchone()[0],0)
        with self.q.db:self.q.db.execute('UPDATE accounts SET paused=1 WHERE instance=?',(INSTANCE,))
        client.recover_read_pause(INSTANCE)
        self.assertEqual(self.q.db.execute('SELECT count(*) FROM jobs').fetchone()[0],3)
        self.assertEqual(self.q.db.execute('SELECT paused FROM accounts WHERE instance=?',(INSTANCE,)).fetchone()[0],1)

    def test_retired_list_is_archived_before_ack_but_mismatches_are_not(self):
        import io
        from urllib.error import HTTPError
        job=self.q.enqueue('list_scan',INSTANCE,payload={'url':'https://letterboxd.com/alice/list/test/','token':str(uuid.uuid4())})
        with self.q.db:self.q.db.execute("UPDATE jobs SET state='succeeded',result=? WHERE id=?",(json.dumps({'snapshot':{'title':'Preserve me'}}),job))
        client=CatalogueClient(self.q,self.config,Mock(side_effect=HTTPError('https://safe',409,'Mismatch',None,io.BytesIO(b'{}'))))
        with self.assertRaises(HTTPError):client.exchange_lists(INSTANCE)
        self.assertIsNone(self.q.db.execute('SELECT 1 FROM list_acks WHERE id=?',(job,)).fetchone())
        client.last_attempt.clear()
        client.send=Mock(side_effect=HTTPError('https://safe',410,'Retired',None,io.BytesIO(b'{"code":"list-job-retired"}')))
        client.exchange_lists(INSTANCE)
        self.assertIsNotNone(self.q.db.execute('SELECT 1 FROM list_acks WHERE id=?',(job,)).fetchone())
        saved=json.loads((self.root/'retired-list-reports'/(job+'.json')).read_text())
        self.assertEqual(json.loads(saved['result'])['snapshot']['title'],'Preserve me')
        self.assertEqual(self.q.db.execute('SELECT paused FROM accounts WHERE instance=?',(INSTANCE,)).fetchone()[0],0)

    def test_account_health_keeps_failures_separate_and_reports_pause_capabilities(self):
        client=CatalogueClient(self.q,self.config)
        client.record_failure(INSTANCE,'lists',ValueError('private review must not appear'))
        with self.q.db:
            self.q.db.execute('UPDATE accounts SET paused=1 WHERE instance=?',(INSTANCE,))
            self.q.db.execute('INSERT INTO readonly_pauses VALUES(?,?)',(INSTANCE,'read-check'))
        health=client.worker_health(INSTANCE)
        self.assertTrue(health['paused'])
        self.assertEqual(health['pauseReason'],'read-check')
        self.assertNotIn('watched',health['supportedWriteKinds'])
        self.assertEqual(health['errors'][0]['stage'],'lists')
        self.assertEqual(client.worker_health('other')['errors'],[])
        stored=(self.config.parent/'account-health.json').read_text()
        self.assertNotIn('private review',stored)
        self.assertEqual(self.q.db.execute('SELECT paused FROM accounts WHERE instance=?',(INSTANCE,)).fetchone()[0],1)

    def test_durable_delivery_deduplicates_same_id_before_and_after_execution(self):
        instance,_,client=self.observation_setup(capability=False)
        job={'action':'media_write','id':str(uuid.uuid4()),'instance':instance,'account':'prplmg','userId':1,'film':'jaws','kind':'rating','expected':{'rating':None},'desired':{'rating':4}}
        client.request=Mock(return_value=job)
        client.exchange_writes(instance)
        self.assertEqual(client.request.call_args.args[1]['durableDelivery'],1)
        self.q.enqueue('media_write',instance,job['id'],payload=job)
        self.assertEqual(self.q.db.execute('SELECT count(*) FROM jobs WHERE id=?',(job['id'],)).fetchone()[0],1)
        self.q.claim(instance)
        self.q.enqueue('media_write',instance,job['id'],payload=job)
        self.assertEqual(self.q.db.execute('SELECT state FROM jobs WHERE id=?',(job['id'],)).fetchone()[0],'running')
        self.q.event(instance,job['id'],{'outcome':'succeeded','writeOutcome':'verified','identity':'prplmg','values':{'rating':4}},True)
        self.q.enqueue('media_write',instance,job['id'],payload=job)
        self.assertEqual(self.q.db.execute('SELECT state FROM jobs WHERE id=?',(job['id'],)).fetchone()[0],'succeeded')
        self.assertIsNone(self.q.claim(instance))

    def test_persistent_error_history_survives_success_and_redacts_private_messages(self):
        client=CatalogueClient(self.q,self.config)
        client.record_failure('one','publishing',ValueError('Account already has pending work'))
        client.record_failure('one','publishing',ValueError('private review token=secret'))
        log=(self.config.parent/'transport-errors.jsonl').read_text()
        self.assertIn('Account already has pending work',log)
        self.assertNotIn('private review',log)
        self.assertNotIn('secret',log)
        self.assertEqual(len(log.splitlines()),2)
    def test_publishing_failure_does_not_suppress_heartbeat_or_retry_write(self):
        from urllib.error import HTTPError
        client=CatalogueClient(self.q,self.config)
        client.exchange_writes=Mock(side_effect=HTTPError('https://private',400,'secret',None,None))
        client.exchange=Mock()
        client.exchange_lists=Mock()
        self.assertEqual(client.exchange_cycle('one'),[{'stage':'publishing','type':'HTTPError','httpStatus':400}])
        client.exchange_writes.assert_called_once_with('one')
        client.exchange.assert_called_once_with('one')
        client.exchange_lists.assert_not_called()

    def test_rating_is_fetched_and_prioritized_ahead_of_queued_list(self):
        instance,_,client=self.observation_setup(capability=False)
        self.q.enqueue('list_scan',instance,payload={'url':'https://letterboxd.com/alice/list/test/','token':str(uuid.uuid4())})
        job={'action':'media_write','id':str(uuid.uuid4()),'instance':instance,'account':'prplmg','userId':1,'film':'jaws','kind':'rating','expected':{'rating':None},'desired':{'rating':4}}
        client.request=Mock(return_value=job)
        client.exchange_writes(instance)
        self.assertEqual(self.q.claim(instance)['id'],job['id'])

    def test_exchange_cycle_reports_both_failures_without_sensitive_messages(self):
        client=CatalogueClient(self.q,self.config)
        client.exchange_writes=Mock(side_effect=ValueError('private review'))
        client.exchange=Mock(side_effect=OSError('private token'))
        self.assertEqual(client.exchange_cycle('one'),[
            {'stage':'publishing','type':'ValueError'},
            {'stage':'heartbeat','type':'OSError'},
        ])
        client.exchange_writes=Mock();client.exchange=Mock()
        self.assertEqual(client.exchange_cycle('one'),[])

    def test_workflow_capability_is_per_profile_loaded_and_fresh(self):
        client=CatalogueClient(self.q,self.config)
        versions=self.config.parent/'worker-versions.json'
        self.assertFalse(client.workflow_capable('one'))
        versions.write_text(json.dumps({'one':{'version':'0.2.46','seenAt':time.time()},'two':{'version':'0.2.44','seenAt':time.time()}}))
        self.assertTrue(client.workflow_capable('one'))
        self.assertFalse(client.workflow_capable('two'))
        versions.write_text(json.dumps({'one':{'version':'0.2.46','seenAt':time.time()-601}}))
        self.assertFalse(client.workflow_capable('one'))

    def test_completed_write_ack_precedes_queued_observation_and_is_not_reexecuted(self):
        instance,observation,client=self.observation_setup()
        values={'rating':4}
        job=self.q.enqueue('media_write',instance,payload={'userId':1,'account':'prplmg','film':'jaws','kind':'rating','expected':{'rating':None},'desired':values})
        self.q.claim(instance)
        self.q.event(instance,job,{'outcome':'succeeded','writeOutcome':'verified','identity':'prplmg','values':values},True)
        self.q.enqueue('review_observe',instance,observation['id'],payload=observation)
        client.request=Mock(side_effect=OSError('lost response'))
        with self.assertRaises(OSError):client.exchange_writes(instance)
        self.assertEqual(client.request.call_args.kwargs,{'writes':True})
        self.assertEqual(self.q.db.execute('SELECT count(*) FROM write_acks').fetchone()[0],0)
        client.request=Mock(return_value={'action':'idle'})
        client.exchange_writes(instance)
        self.assertEqual(client.request.call_args.args[1]['report']['id'],job)
        self.assertEqual(self.q.db.execute('SELECT count(*) FROM write_acks').fetchone()[0],1)
        self.assertEqual(self.q.db.execute("SELECT count(*) FROM jobs WHERE action='media_write'").fetchone()[0],1)

    def observation_setup(self, capability=True, username='prplmg', user_id=1):
        instance='6e282ef9-86a2-4356-9387-16f99807e283' if user_id == 1 else str(uuid.uuid4())
        self.q.db.execute('INSERT INTO accounts VALUES(?,?,0)',(instance,username));self.q.db.commit()
        probe=self.q.enqueue('identity_probe',instance);self.q.claim(instance)
        self.q.event(instance,probe,{'outcome':'succeeded','identity':username},True)
        config={'token':'test','instances':[instance],'accounts':{instance:username}}
        if capability:config['supportedObservations']=['review_observe']
        self.config.write_text(json.dumps(config))
        job={'id':str(uuid.uuid4()),'action':'review_observe','instance':instance,'userId':user_id,'account':username,'film':'jaws','claimToken':str(uuid.uuid4()),'claimedAt':time.time()*1000}
        client=CatalogueClient(self.q,self.config);client.request=Mock(return_value=job)
        return instance,job,client
    def test_nonpilot_binding_rejects_other_accounts_and_accepts_its_own_write(self):
        instance,observation,client=self.observation_setup(False,'evegrissel',7)
        job={'id':str(uuid.uuid4()),'action':'media_write','kind':'rating','instance':instance,'userId':7,'account':'evegrissel','film':'jaws','expected':{'rating':None},'desired':{'rating':4}}
        client.request=Mock(return_value={**job,'account':'prplmg'})
        with self.assertRaises(ValueError):client.exchange_writes(instance)
        client.request=Mock(return_value=job);client.exchange_writes(instance)
        self.assertEqual(self.q.claim(instance)['account'],'evegrissel')
        self.q.event(instance,job['id'],{'outcome':'succeeded','identity':'evegrissel','values':{'rating':4}},True)
        client.request=Mock(side_effect=OSError('lost response'))
        with self.assertRaises(OSError):client.exchange_writes(instance)
        client.request=Mock(return_value={'action':'idle'});client.exchange_writes(instance)
        self.assertEqual(self.q.db.execute('SELECT count(*) FROM write_acks WHERE id=?',(job['id'],)).fetchone()[0],1)
        self.assertEqual(self.q.db.execute("SELECT count(*) FROM jobs WHERE action='media_write'").fetchone()[0],1)
    def test_old_configuration_never_advertises_or_claims_observations(self):
        instance,_,client=self.observation_setup(False)
        self.assertFalse(client.exchange_observations(instance));client.request.assert_not_called()
    def test_observation_delivery_and_report_retry_are_durable(self):
        instance,job,client=self.observation_setup()
        client.exchange_writes(instance)
        self.assertEqual(client.request.call_args.kwargs,{'observations':True})
        self.assertEqual(client.request.call_args.args[1]['supported'],['review_observe'])
        self.q.claim(instance)
        self.q.event(instance,job['id'],{'outcome':'succeeded','observationStatus':'verified','identity':'prplmg','complete':True,
          'observation':{'rating':None,'text':'','spoiler':False,'observedAt':time.time()*1000}},True)
        client.request=Mock(side_effect=OSError('offline'))
        with self.assertRaises(OSError):client.exchange_observations(instance)
        self.assertEqual(self.q.db.execute('SELECT count(*) FROM observation_acks').fetchone()[0],0)
        client.request=Mock(return_value={'action':'idle'});client.exchange_observations(instance)
        report=client.request.call_args.args[1]['report']
        self.assertEqual(report['claimToken'],job['claimToken']);self.assertEqual(report['status'],'verified')
        self.assertTrue(report['identityVerified']);self.assertTrue(report['complete'])
        self.assertEqual(self.q.db.execute('SELECT count(*) FROM observation_acks').fetchone()[0],1)
    def test_observation_transport_rejects_mutating_or_wrong_account_actions(self):
        instance,job,client=self.observation_setup()
        for change in ({'action':'watchlist_set'},{'action':'media_write'},{'account':'other'},{'userId':0},{'instance':INSTANCE}):
            client.request=Mock(return_value={**job,**change})
            with self.assertRaises(ValueError):client.exchange_observations(instance)
        self.assertEqual(self.q.db.execute('SELECT count(*) FROM observation_payloads').fetchone()[0],0)
    def test_paused_account_can_run_read_only_recovery_but_stays_paused(self):
        instance,job,client=self.observation_setup()
        self.q.db.execute('UPDATE accounts SET paused=1 WHERE instance=?',(instance,));self.q.db.commit()
        client.exchange_observations(instance)
        self.assertEqual(self.q.claim(instance)['action'],'review_observe')
        self.assertEqual(self.q.db.execute('SELECT paused FROM accounts WHERE instance=?',(instance,)).fetchone()[0],1)
    def test_verified_recovery_reconciles_original_job_without_submitting_again(self):
        instance,job,client=self.observation_setup()
        expected={'rating':None,'text':'','spoiler':False};desired={'rating':2.5,'text':'test','spoiler':True}
        write=self.q.enqueue('media_write',instance,payload={'userId':1,'account':'prplmg','film':'jaws','kind':'review','originEntityId':'local:1:1','expected':expected,'desired':desired})
        self.q.claim(instance);self.q.event(instance,write,{'outcome':'unknown','writeOutcome':'unknown','identity':'prplmg'},True)
        client.exchange_observations(instance);self.q.claim(instance)
        entry='https://letterboxd.com/prplmg/film/jaws/1/'
        self.q.event(instance,job['id'],{'outcome':'succeeded','observationStatus':'verified','identity':'prplmg','complete':True,'observation':{**desired,'entryId':entry,'observedAt':time.time()*1000}},True)
        client.request=Mock(return_value={'action':'idle','recovered':[{'id':write,'values':desired,'entryId':entry}],'resumeWrites':True})
        client.exchange_observations(instance)
        self.assertEqual(self.q.db.execute('SELECT state FROM jobs WHERE id=?',(write,)).fetchone()[0],'succeeded')
        self.assertEqual(self.q.db.execute('SELECT paused FROM accounts WHERE instance=?',(instance,)).fetchone()[0],0)
        self.assertEqual(self.q.db.execute("SELECT count(*) FROM jobs WHERE action='media_write'").fetchone()[0],1)
    def test_unknown_report_survives_pause_and_capability_removal(self):
        instance,job,client=self.observation_setup();client.exchange_observations(instance);self.q.claim(instance)
        self.q.event(instance,job['id'],{'outcome':'blocked','observationStatus':'ambiguous','identity':'prplmg','complete':False},True)
        config=json.loads(self.config.read_text());del config['supportedObservations'];self.config.write_text(json.dumps(config))
        client.request=Mock(return_value={'action':'idle'});client.exchange_observations(instance)
        sent=client.request.call_args.args[1]
        self.assertEqual(sent['supported'],[]);self.assertEqual(sent['report']['status'],'ambiguous')
        self.assertNotIn('observation',sent['report'])
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.root=Path(self.tmp.name)
        self.q=Queue(self.root/'queue.sqlite')
        job=self.q.enqueue('identity_probe');self.q.claim(INSTANCE)
        self.q.event(INSTANCE,job,{'outcome':'succeeded','identity':'prplmg'},True)
        self.config=self.root/'catalogue.json'
        self.config.write_text(json.dumps({'token':'scoped-test-token','instances':[INSTANCE],'accounts':{INSTANCE:'prplmg'}}))
        self.job={'id':str(uuid.uuid4()),'action':'watchlist_scan','instance':INSTANCE,'account':'prplmg'}
    def tearDown(self):
        self.q.db.close();self.tmp.cleanup()
    def test_repeated_delivery_and_bridge_restart_do_not_duplicate(self):
        for _ in range(2):
            CatalogueClient(self.q,self.config,lambda *_:self.job).exchange(INSTANCE)
        self.assertEqual(self.q.db.execute("SELECT count(*) FROM jobs WHERE action='watchlist_scan'").fetchone()[0],1)
    def test_rejects_mutating_or_other_account_jobs(self):
        for extra in ({'action':'watchlist_cycle'},{'account':'someone-else'},{'instance':str(uuid.uuid4())}):
            with self.assertRaises(ValueError):
                CatalogueClient(self.q,self.config,lambda *_:{**self.job,**extra}).exchange(INSTANCE)
    def test_reports_only_verified_snapshot_fields(self):
        CatalogueClient(self.q,self.config,lambda *_:self.job).exchange(INSTANCE)
        self.q.claim(INSTANCE)
        self.q.event(INSTANCE,self.job['id'],{'stage':'watchlist-snapshot','outcome':'succeeded','identity':'prplmg','complete':True,'items':[{'slug':'jaws','title':'Jaws'}]},True)
        sent=[]
        CatalogueClient(self.q,self.config,lambda token,payload:sent.append(payload) or {'action':'idle'}).exchange(INSTANCE)
        self.assertEqual(set(sent[0]['report']),{'id','outcome','identity','complete','items'})
    def test_unconfigured_instances_cannot_contact_catalogue(self):
        CatalogueClient(self.q,self.config,lambda *_:self.fail('Unexpected request')).exchange('other')

    def test_configured_other_account_cannot_receive_prplmg_job(self):
        self.q.db.execute('UPDATE accounts SET username=? WHERE instance=?',('another',INSTANCE))
        self.q.db.commit()
        self.config.write_text(json.dumps({'token':'test','instances':[INSTANCE],'accounts':{INSTANCE:'another'}}))
        with self.assertRaises(ValueError):
            CatalogueClient(self.q,self.config,lambda *_:self.job).exchange(INSTANCE)
        CatalogueClient(self.q,self.config,lambda *_:{'action':'idle'}).exchange(INSTANCE)

    def test_private_origin_retains_certificate_hostname(self):
        connection=CatalogueOriginConnection('catalogue.prpl.com.mx:8443',timeout=8)
        connection._create_connection=Mock()
        connection._context=Mock()
        connection.connect()
        connection._create_connection.assert_called_once_with(('192.168.68.55',8443),8,None)
        connection._context.wrap_socket.assert_called_once_with(connection._create_connection.return_value,server_hostname='catalogue.prpl.com.mx')

    def test_private_origin_rejects_other_hosts(self):
        connection=CatalogueOriginConnection('example.com:8443')
        connection._create_connection=Mock()
        with self.assertRaises(ValueError):connection.connect()
        connection._create_connection.assert_not_called()

    def test_write_delivery_verified_ack_and_replay(self):
        instance='6e282ef9-86a2-4356-9387-16f99807e283'
        self.q.db.execute('INSERT INTO accounts VALUES(?,?,0)',(instance,'prplmg'));self.q.db.commit()
        probe=self.q.enqueue('identity_probe',instance);self.q.claim(instance)
        self.q.event(instance,probe,{'outcome':'succeeded','identity':'prplmg'},True)
        self.config.write_text(json.dumps({'token':'test','instances':[instance],'accounts':{instance:'prplmg'}}))
        job={'id':str(uuid.uuid4()),'action':'media_write','kind':'rating','instance':instance,'account':'prplmg','userId':1,'film':'the-great-train-robbery','expected':{'rating':None},'desired':{'rating':4}}
        client=CatalogueClient(self.q,self.config)
        client.request=Mock(return_value=job)
        client.exchange_writes(instance)
        self.assertEqual(client.request.call_args.args[1]['supported'], ['rating','review','diary'])
        claimed=self.q.claim(instance)
        self.assertEqual(claimed['desired'],{'rating':4})
        client.exchange_writes(instance)
        self.assertEqual(client.request.call_count,1)
        with self.assertRaises(ValueError):self.q.event(instance,job['id'],{'outcome':'succeeded','identity':'prplmg','values':{'rating':3}},True)
        self.q.event(instance,job['id'],{'outcome':'succeeded','identity':'prplmg','values':{'rating':4}},True)
        client.request=Mock(return_value={'action':'idle'})
        client.exchange_writes(instance)
        self.assertEqual(client.request.call_args.args[1]['report']['outcome'],'verified')
        self.assertEqual(client.request.call_args.args[1]['supported'], ['rating','review','diary'])
        self.assertEqual(self.q.db.execute('SELECT count(*) FROM write_acks').fetchone()[0],1)
        self.assertEqual(self.q.enqueue('media_write',instance,job['id'],payload=job),job['id'])
        with self.assertRaises(ValueError):self.q.enqueue('media_write',instance,job['id'],payload={**job,'desired':{'rating':3}})

    def test_review_receipt_retries_after_network_failure_without_new_dispatch(self):
        instance='6e282ef9-86a2-4356-9387-16f99807e283'
        self.q.db.execute('INSERT INTO accounts VALUES(?,?,0)',(instance,'prplmg'));self.q.db.commit()
        probe=self.q.enqueue('identity_probe',instance);self.q.claim(instance)
        self.q.event(instance,probe,{'outcome':'succeeded','identity':'prplmg'},True)
        self.config.write_text(json.dumps({'token':'test','instances':[instance],'accounts':{instance:'prplmg'}}))
        values={'rating':4,'text':'Review','spoiler':True}
        job={'id':str(uuid.uuid4()),'action':'media_write','kind':'review','instance':instance,'account':'prplmg','userId':1,'film':'jaws','originEntityId':'review-1','expected':values,'desired':values}
        client=CatalogueClient(self.q,self.config);client.request=Mock(return_value=job)
        client.exchange_writes(instance);self.q.claim(instance)
        entry='https://letterboxd.com/prplmg/film/jaws/'
        self.q.event(instance,job['id'],{'outcome':'succeeded','identity':'prplmg','values':values,'entryId':entry},True)
        client.request=Mock(side_effect=OSError('offline'))
        with self.assertRaises(OSError):client.exchange_writes(instance)
        self.assertEqual(self.q.db.execute('SELECT count(*) FROM write_acks').fetchone()[0],0)
        client.request=Mock(return_value={'action':'idle'});client.exchange_writes(instance)
        self.assertEqual(client.request.call_args.args[1]['report']['entryId'],entry)
        self.assertEqual(self.q.db.execute('SELECT count(*) FROM write_acks').fetchone()[0],1)
        client.request=Mock(return_value={**job,'action':'watchlist_set'})
        with self.assertRaises(ValueError):client.exchange_writes(instance)

    def test_worker_rejects_uninstalled_adapters_even_if_server_dispatches_them(self):
        instance='6e282ef9-86a2-4356-9387-16f99807e283'
        self.q.db.execute('INSERT INTO accounts VALUES(?,?,0)',(instance,'prplmg'));self.q.db.commit()
        self.config.write_text(json.dumps({'token':'test','instances':[instance],'accounts':{instance:'prplmg'}}))
        client=CatalogueClient(self.q,self.config)
        for kind in ('watched','watchlist','unknown',None):
            client.request=Mock(return_value={'action':'media_write','kind':kind,'instance':instance,'account':'prplmg'})
            with self.assertRaisesRegex(ValueError,'Unsupported write kind'):client.exchange_writes(instance)
            self.assertEqual(client.request.call_args.args[1]['supported'], ['rating','review','diary'])
        self.assertEqual(self.q.db.execute('SELECT count(*) FROM write_payloads').fetchone()[0],0)

if __name__=='__main__':unittest.main()
