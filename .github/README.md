# GitHub Workflows

This directory contains CI/CD workflows for automated testing and release.

## Workflows

### test-and-release.yml

**Triggers:**
- Push to `main` branch
- Pull requests
- Tags matching `v*.*.*` pattern

**Jobs:**
1. **check-and-lint:** ESLint validation, package file checks
2. **adapter-tests:** Unit tests on Node.js 14.x, 16.x, 18.x, 20.x
3. **deploy:** Publishes to npm when tagged (requires `NPM_TOKEN` secret)

### adapter-checker.yml

**Triggers:**
- Push to `main` branch
- Pull requests

**Job:**
- Runs ioBroker Adapter Checker to validate adapter compliance

## Required Secrets

To enable automatic npm publishing, add the following secrets to your GitHub repository:

### NPM_TOKEN

1. Log in to npm: `npm login`
2. Generate access token: `npm token create`
3. Copy the token
4. Add to GitHub: Settings → Secrets → Actions → New repository secret
   - Name: `NPM_TOKEN`
   - Value: `<your-token>`

## Release Process

### Automated Release (Recommended)

```bash
# Patch release (1.1.0 → 1.1.1)
npm run release

# Minor release (1.1.0 → 1.2.0)
npm run release:minor

# Major release (1.1.0 → 2.0.0)
npm run release:major
```

This will:
1. Update version in `package.json` and `io-package.json`
2. Update `CHANGELOG.md`
3. Commit changes
4. Create git tag (`v1.2.0`)
5. Push to GitHub
6. Trigger CI/CD workflow
7. Publish to npm (if tests pass)

### Manual Release

```bash
# Update version
npm version patch  # or minor, major

# Push with tags
git push --follow-tags

# Workflow will auto-publish
```

## Development Workflow

### Before Pushing

```bash
# Check code quality
npm run check

# Fix linting issues
npm run lint:fix

# Run all tests
npm test
```

### Pull Request Workflow

1. Create feature branch: `git checkout -b feature/my-feature`
2. Make changes and commit
3. Push to GitHub: `git push origin feature/my-feature`
4. Create Pull Request
5. Wait for CI checks to pass
6. Merge when approved

## Troubleshooting

### Tests Failing on CI but Passing Locally

- Check Node.js version (CI tests on 14.x, 16.x, 18.x, 20.x)
- Verify dependencies: `npm ci` (clean install)
- Check environment variables

### Deploy Job Not Running

- Ensure commit is tagged (`git tag v1.2.0`)
- Check tag format matches `v*.*.*`
- Verify `NPM_TOKEN` secret is set

### Adapter Checker Failures

- Run locally: `npx @iobroker/adapter-dev check`
- Review error messages
- Update adapter metadata if needed

## More Information

- [ioBroker Adapter Development](https://github.com/ioBroker/ioBroker.docs/blob/master/docs/en/dev/adapterdev.md)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Release Script Documentation](https://github.com/AlCalzone/release-script)
