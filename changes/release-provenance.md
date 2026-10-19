### New
- **Every release carries signed build provenance.** `gh attestation verify .\Shellby-Setup-x.y.z.exe -R x-salmon/shellby` confirms a download was built by GitHub Actions from the tagged source, and the release lists the Sigstore bundle as `Shellby-x.y.z.intoto.jsonl`.
