# Mini Credential Manager test — 2026-11-07

The user authorized persistent credential storage and a no-reboot unattended access test. The real OpenAI key is now stored as a Windows Generic Credential named `Multimeldia/OpenAI`, under `DESKTOP-ATPF6SJ\minilie`, with local-machine persistence. Its value was never printed, placed in command arguments, or saved in plaintext files.

Live Seerr task principal: minilie, S4U (LogonType 2), Highest (RunLevel 1). A disposable task cloned this exact principal. SSH could not open the vault (Win32 1312), and the interactive control had no logged-in session (267011). Creating the dummy credential within S4U succeeded, and a separate fresh S4U process retrieved the persisted value successfully.

The real key moved from the temporary Mac memory helper via SSH stdin to a named pipe restricted to minilie's SID. The S4U receiver wrote it directly to Credential Manager. Another fresh S4U task retrieved it and made GET https://api.openai.com/v1/models: HTTP 200 at 2026-11-07T13:32:26Z. Only status/identity metadata was recorded; no model generation or token spend was requested.

This verifies unattended credential access with the current task mode without an interactive session. It does not constitute a cold-boot test. Windows documents S4U restrictions on network credentials/encrypted files; observed Credential Manager success on this machine should not be generalized to other accounts or logon setups.

No deployment, reboot, Seerr restart, task-principal change, publishing toggle changes, or startup-loader changes. Seerr remained Running. The application still needs credential retrieval wired into its launcher before AI Search can use this credential in production. PRPL-PC builds must never receive the key.

Disposable tasks and dummy credential are cleaned up after collecting evidence; the real credential remains intentionally stored. Temporary probe scripts and sanitized receipts are retained under C:\ProgramData\Seerr\tools\credential-probe-20261107 for audit. Source/evidence scripts are also under workspace outputs/ai-search-20261107/credential-test (not deployment artifacts).
