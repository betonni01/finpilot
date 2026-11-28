from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("sync", "0002_vault_usage_bytes_invite_passwordreset"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="SharedBoard",
            fields=[
                ("id", models.CharField(max_length=64, primary_key=True, serialize=False)),
                ("payload", models.TextField()),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("owner", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="shared_boards", to=settings.AUTH_USER_MODEL)),
            ],
        ),
    ]
