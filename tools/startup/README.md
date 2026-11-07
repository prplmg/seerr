# Mini startup credential loader

`Start-Seerr.ps1` runs within the existing Seerr scheduled task (minilie/S4U/Highest). It retrieves Generic Credential `Multimeldia/OpenAI`, passes it to the child Node process as OPENAI_API_KEY, and clears the wrapper environment on exit. Missing credentials disable AI Search but do not take down the catalogue. Never invoke it on the builder or print the environment.

Keep the existing run-seerr.cmd environment, working directory and log redirection. Replace only its Node invocation with:

    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\ProgramData\Seerr\tools\startup\Start-Seerr.ps1" >> "C:\ProgramData\Seerr\logs\seerr.log" 2>&1

Back up run-seerr.cmd before changing it. `-Probe` runs a child Node process that reports only credential presence, not the key, without starting the catalogue. This must run under the same task identity; SSH does not have equivalent vault access. Tested successfully without an interactive login on 2026-11-07. A cold reboot is not part of that verification.

This wrapper stays on Mini, outside application release artifacts. Restore the backed-up run-seerr.cmd to roll back the startup change. Application rollbacks remain maintenance-aware and work with this wrapper. No machine-wide environment variable or plaintext credential file is used.
