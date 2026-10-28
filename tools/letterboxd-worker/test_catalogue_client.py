import json
import tempfile
import unittest
import uuid
import time
from unittest.mock import Mock
from pathlib import Path
from queue_store import Queue, INSTANCE
from catalogue_client import CatalogueClient, CatalogueOriginConnection

class CatalogueClientTests(unittest.TestCase):
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
