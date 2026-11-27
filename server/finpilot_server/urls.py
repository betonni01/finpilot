from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from sync import accounts, views

urlpatterns = [
    path("api/health/", views.health),
    path("api/auth/register/", views.register),
    path("api/auth/token/", views.LoginView.as_view()),
    path("api/auth/token/refresh/", TokenRefreshView.as_view()),
    path("api/auth/me/", accounts.me),
    path("api/auth/logout-all/", views.logout_all),
    path("api/auth/password/", views.change_password),
    path("api/auth/password-reset/", accounts.password_reset_request),
    path("api/auth/password-reset/confirm/", accounts.password_reset_confirm),
    path("api/auth/account/", views.delete_account),
    path("api/sync/keyinfo/", views.keyinfo),
    path("api/sync/pull/", views.pull),
    path("api/sync/push/", views.push),
    path("api/sync/reset/", views.reset_data),
    path("api/push/vapid/", views.vapid_key),
    path("api/push/subscribe/", views.subscribe),
    path("api/push/reminders/", views.reminders),
    path("api/admin/users/", accounts.admin_users),
    path("api/admin/users/<int:pk>/", accounts.admin_user),
    path("api/admin/users/<int:pk>/reset-code/", accounts.admin_reset_code),
    path("api/admin/invites/", accounts.admin_invites),
    path("api/admin/invites/<int:pk>/", accounts.admin_invite),
]
