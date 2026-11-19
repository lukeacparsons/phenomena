import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ACTIVATE = Path(__file__).resolve().parents[1] / 'deploy/vobarna/activate.py'


class PublicationTest(unittest.TestCase):
    def test_invalid_release_preserves_live_site_and_success_keeps_one_rollback(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            def release(number, corrupt=False):
                name = f'release-20261119T12000{number}-' + str(number) * 12
                target = root / 'releases' / name
                (target / 'public/en').mkdir(parents=True)
                (target / 'public/en/index.html').write_text(f'<h1>{number}</h1>')
                (target / 'registry.json').write_text('{}')
                (target / 'public/404.html').write_text('Missing')
                (target / 'public/routes.json').write_text(json.dumps({'origin':'https://vobarna.com','pages':['/en/','/404.html']}))
                files = {str(p.relative_to(target)): hashlib.sha256(p.read_bytes()).hexdigest() for p in target.rglob('*') if p.is_file()}
                (target / 'deployment.json').write_text(json.dumps({'files':files}))
                target.chmod(0o700)
                if corrupt:
                    (target / 'public/en/index.html').write_text('Incomplete transfer')
                return target
            def activate(target):
                return subprocess.run([sys.executable, str(ACTIVATE), target.name],
                    env={**os.environ, 'VOBARNA_PUBLICATION_ROOT':str(root)}, capture_output=True)
            first = release(1)
            self.assertEqual(activate(first).returncode, 0)
            self.assertEqual(first.stat().st_mode & 0o777, 0o755)
            bad = release(2, corrupt=True)
            self.assertNotEqual(activate(bad).returncode, 0)
            self.assertEqual((root / 'current').resolve(), first)
            second = release(3)
            self.assertEqual(activate(second).returncode, 0)
            self.assertEqual((root / 'current').resolve(), second)
            self.assertEqual(set((root / 'releases').iterdir()), {first, second})


if __name__ == '__main__':
    unittest.main()
