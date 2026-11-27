from rest_framework.throttling import SimpleRateThrottle


class AuthThrottle(SimpleRateThrottle):
    """Limite les tentatives de connexion, d'inscription et de réinitialisation par adresse IP."""
    scope = "auth"

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}
