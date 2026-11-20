<p align="center">
  <img src="./logo.png" alt="gmail2obsidian" width="512" />
  <br />
  <!-- repo-tagline:start -->
  <strong>📬 Turn labeled Gmail threads into Obsidian tasks ✅</strong>
  <!-- repo-tagline:end -->
</p>

gmail2obsidian turns labeled Gmail threads into tasks in existing Obsidian
Markdown files on Google Drive. Open the Apps Script web app and confirm the
flush. Successfully imported threads have their processed label removed
and are archived.

## Setup

1. Run `make setup` from the checkout and configure the labels and destination
   files in the generated `config.gs`.
2. Run `make check test` to validate the configuration with mocked Google
   services.
3. Follow the [deployment guide](docs/setup.md#setup) to install the script
   as an owner-only Apps Script web app.

Opening the web app shows a confirmation page. Confirming writes to Drive
and changes the processed Gmail threads. Start with a test label and an
existing target file. The summary shows the result for each route.

See the [setup and operations guide](docs/setup.md) for manual updates,
label routing, troubleshooting, and the optional webhook.

## License

[MIT License](LICENSE).
