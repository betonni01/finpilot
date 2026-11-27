import logging
import os
import threading
import time

from django.core.wsgi import get_wsgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "finpilot_server.settings")
application = get_wsgi_application()

def _reminder_loop():
    """Sur Render (un seul service), envoie les rappels tant que l'instance est éveillée."""
    time.sleep(20)
    from django.conf import settings
    from sync.management.commands.send_reminders import run_once
    log = logging.getLogger("finpilot.reminders")
    while True:
        try:
            if settings.VAPID_PRIVATE_KEY:
                n = run_once()
                if n:
                    log.info("%s rappel(s) envoyé(s)", n)
        except Exception:
            log.exception("envoi des rappels")
        time.sleep(int(os.environ.get("FINPILOT_REMINDER_INTERVAL", "60")))

if os.environ.get("RENDER") and os.environ.get("FINPILOT_REMINDER_LOOP", "1") not in ("0", "false", "no"):
    threading.Thread(target=_reminder_loop, name="finpilot-reminders", daemon=True).start()
