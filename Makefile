.DEFAULT_GOAL := check
.PHONY: check test setup
check:
	node --check scripts/check.cjs
	node --check tests/gmail2obsidian.test.cjs
	node scripts/check.cjs

test:
	node --test tests/gmail2obsidian.test.cjs
	PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p 'test_*.py'

setup:
	git config core.hooksPath .githooks
	@test -f config.gs || cp config.example.gs config.gs
	@echo "Setup complete. Edit config.gs, run make check test, then follow README.md's manual Apps Script deployment steps."
