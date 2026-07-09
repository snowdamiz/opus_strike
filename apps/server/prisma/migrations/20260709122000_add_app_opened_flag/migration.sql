-- Records the first time an account is opened from the installed home-screen
-- App (standalone display mode). The web client reads it back to nudge returning
-- App users to switch, which iOS cannot otherwise detect across the PWA/Safari
-- storage split.
ALTER TABLE "User"
  ADD COLUMN "appOpenedAt" TIMESTAMP(3);
