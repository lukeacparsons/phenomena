import json
from pathlib import Path
import tempfile
import unittest

from serve_deployed_site import prepare_input


class DeploymentInputTests(unittest.TestCase):
    def test_data_refresh_never_imports_uploaded_code_or_replaces_existing_registry(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            incoming, cache, registry = root / 'incoming', root / 'cache', root / 'registry.json'
            for version in (1, 2):
                source = incoming / f'release-{version}'
                (source / 'public/preview-data/posters').mkdir(parents=True)
                (source / 'catalogue.json').write_text(json.dumps({'version': version}))
                (source / 'registry.json').write_text(json.dumps({'version': version}))
                (source / 'public/availability.json').write_text(json.dumps({'version': version}))
                (source / 'public/index.html').write_text('Old uploaded page')
                (source / 'public/theme.js').write_text('Old uploaded script')
                (source / 'public/preview-data/posters/test.webp').write_bytes(bytes([version]))
                (incoming / 'current').unlink(missing_ok=True)
                (incoming / 'current').symlink_to(source)
                self.assertEqual(prepare_input(incoming, cache, registry), source.name)
                self.assertEqual(json.loads((cache / 'screenings.json').read_text())['version'], version)
                self.assertEqual(json.loads((cache / 'availability.json').read_text())['version'], version)
                self.assertEqual((cache / 'posters/test.webp').read_bytes(), bytes([version]))
                self.assertEqual(json.loads(registry.read_text())['version'], 1)
                self.assertFalse((cache / 'index.html').exists())
                self.assertFalse((cache / 'theme.js').exists())
