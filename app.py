import json
import logging
import time
import subprocess
import os
from bs4 import BeautifulSoup

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger(__name__)

class IVASSMSClient:
    def __init__(self):
        self.logged_in = True # Assume true karena Chrome yang handle
        self.script_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'api.js')

    def _call_node(self, *args):
        try:
            cmd = ['node', self.script_path] + list(args)
            result = subprocess.run(cmd, capture_output=True, text=True)
            
            # Print STDERR (Debug info dari Node)
            if result.stderr:
                print("NODE STDERR:", result.stderr)
            
            if result.returncode != 0:
                logger.error(f"Node Error: {result.stderr}")
                return None
            
            output = result.stdout.strip()
            if not output: return None
            
            return json.loads(output)
        except Exception as e:
            logger.error(f"Bridge Exception: {e}")
            return None

    def login_with_cookies(self):
        # Login is handled by external Node script (login.js)
        # We just assume if node can fetch data, we are logged in.
        return True

    def get_live_messages(self):
        """
        Mengambil semua pesan LIVE dari halaman portal/live/my_sms
        Return format:
        [
            {
                "range": "AZERBAIJAN 5991",
                "number": "994771105773",
                "message": "Your WhatsApp code: 517-151..."
            },
            ...
        ]
        """
        data = self._call_node('getsms')
        if not data or 'live_sms' not in data:
            return []
        
        return data['live_sms']

