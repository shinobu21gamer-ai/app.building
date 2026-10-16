-- Accounts can be locked pending a password reset when a user reports an unrecognized sign-in.
ALTER TABLE "User" ADD COLUMN "loginLockedAt" TIMESTAMP(3);
