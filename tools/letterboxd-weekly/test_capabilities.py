import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import Mock
from catalogue_client import CatalogueClient, DIARY_CONTENT_ADAPTERS
from queue_store import Queue, INSTANCE

class CapabilityContract(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.q = Queue(self.root / 'queue.sqlite')
        self.config = self.root / 'catalogue.json'
        self.config.write_text(json.dumps({'token':'test','instances':[INSTANCE], 'accounts':{INSTANCE:'prplmg'}}))
        self.client = CatalogueClient(self.q, self.config)
        self.client.request = Mock(return_value={'action':'idle'})
    def tearDown(self):
        self.q.db.close()
        self.tmp.cleanup()
    def version(self, version, age=0):
        (self.root/'worker-versions.json').write_text(json.dumps({INSTANCE:{'version':version,'seenAt':time.time()-age}}))
    def test_shipped_manifest_can_publish_review_diary_and_reports_same_capability(self):
        version = json.loads(Path(__file__).with_name('manifest.json').read_text())['version']
        self.assertIn(version, DIARY_CONTENT_ADAPTERS)
        self.version(version)
        self.assertTrue(self.client.workflow_capable(INSTANCE))
        self.assertIn('diary-content', self.client.worker_health(INSTANCE)['supportedWriteKinds'])
        self.client.exchange_writes(INSTANCE)
        self.assertIn('diary-content', self.client.request.call_args.args[1]['supported'])
        self.assertEqual(self.client.request.call_args.args[1]['durableDelivery'],1)
    def test_freshness_identity_and_unknown_versions_fail_closed(self):
        for version, age in [('0.2.49',601),('0.2.49',-30),('0.2.51',0),('malformed',0)]:
            with self.subTest(version=version,age=age):
                self.version(version,age)
                self.assertFalse(self.client.workflow_capable(INSTANCE))
                self.assertNotIn('diary-content',self.client.worker_health(INSTANCE)['supportedWriteKinds'])
        self.version('0.2.49')
        self.assertFalse(self.client.workflow_capable('another-profile'))
    def test_previous_explicitly_supported_versions_remain_supported(self):
        for version in ['0.2.46','0.2.47','0.2.48','0.2.49']:
            self.version(version)
            self.assertTrue(self.client.workflow_capable(INSTANCE))
