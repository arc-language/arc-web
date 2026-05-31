import CmsLayout from "site/cms/CmsLayout.arc"
import CmsEmpty from "@arc-cms/widgets/CmsEmpty.arc"

page "Forbidden - Admin"

  CmsLayout title="Forbidden" active=""
    CmsEmpty title="403 - Forbidden" body="Your account does not have admin access. Sign in with an admin account to continue." icon="⛔"
      link href="/admin/login"
        button class="!btn !btn--primary" "Sign in as admin"
