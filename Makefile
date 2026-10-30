require-config:
	@test -f config.gs || (echo "Error: config.gs not found. Run 'make setup' first, then edit config.gs" && exit 1)

.PHONY: check test push deploy require-config require-deployment
check:
	node --check scripts/check.cjs
	node --check tests/gmail2obsidian.test.cjs
	node scripts/check.cjs

test:
	node --test tests/gmail2obsidian.test.cjs

require-deployment:
	@test -n "$(DEPLOYMENT_ID)" || (echo "Error: set DEPLOYMENT_ID to the intended active deployment before uploading." && exit 1)

push: require-config check test
	clasp push

deploy: require-deployment push
	@set -eu; DESC=$$(date +%Y-%m-%d_%H:%M); \
	VERSION_OUTPUT=$$(clasp version "$$DESC"); \
	echo "$$VERSION_OUTPUT"; \
	VERSION=$$(echo "$$VERSION_OUTPUT" | grep -Eo '[0-9]+' | tail -1); \
	RESULT=$$(clasp redeploy "$(DEPLOYMENT_ID)" -V "$$VERSION" -d "$$DESC") || exit $$?; \
		echo "$$RESULT"; \
		echo ""; \
		echo "Existing deployment updated. Review access settings in Apps Script before use."

open:
	clasp open

login:
	clasp login

setup:
	git config core.hooksPath .githooks
	@test -f .clasp.json || echo '{"scriptId":"YOUR_SCRIPT_ID_HERE","rootDir":"."}' > .clasp.json
	@test -f config.gs || cp config.example.gs config.gs
	@echo ""
	@echo "Setup complete. Next steps:"
	@echo "  1. npm install -g @google/clasp"
	@echo "  2. make login"
	@echo "  3. Enable Apps Script API: https://script.google.com/home/usersettings"
	@echo "  4. Copy your Script ID from: script.google.com > Project Settings"
	@echo "  5. Edit .clasp.json and replace YOUR_SCRIPT_ID_HERE"
	@echo "  6. Edit config.gs with your vault path and routes"
	@echo "  7. make push, then create an owner-only Web app in Apps Script. For later updates, make deploy DEPLOYMENT_ID=your-deployment-id"
