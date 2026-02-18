'use strict';

const { expect } = require('chai');
const fs = require('fs');
const path = require('path');

describe('Package files', () => {
    describe('package.json', () => {
        let packageJson;

        before(() => {
            const packagePath = path.join(__dirname, '../../package.json');
            packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
        });

        it('should have a valid name', () => {
            expect(packageJson.name).to.equal('iobroker.mcdu');
        });

        it('should have a valid version', () => {
            expect(packageJson.version).to.match(/^\d+\.\d+\.\d+$/);
        });

        it('should have required dependencies', () => {
            expect(packageJson.dependencies).to.be.an('object');
            expect(packageJson.dependencies).to.have.property('@iobroker/adapter-core');
            expect(packageJson.dependencies).to.have.property('mqtt');
            expect(packageJson.dependencies).to.have.property('sprintf-js');
        });

        it('should have a main entry point', () => {
            expect(packageJson.main).to.equal('main.js');
            const mainPath = path.join(__dirname, '../../', packageJson.main);
            expect(fs.existsSync(mainPath)).to.be.true;
        });

        it('should have required scripts', () => {
            expect(packageJson.scripts).to.be.an('object');
            expect(packageJson.scripts).to.have.property('test');
            expect(packageJson.scripts).to.have.property('lint');
        });

        it('should have repository information', () => {
            expect(packageJson.repository).to.be.an('object');
            expect(packageJson.repository.type).to.equal('git');
            expect(packageJson.repository.url).to.be.a('string');
        });

        it('should have author information', () => {
            expect(packageJson.author).to.be.an('object');
            expect(packageJson.author.name).to.be.a('string');
            expect(packageJson.author.email).to.be.a('string');
        });

        it('should have a valid license', () => {
            expect(packageJson.license).to.equal('MIT');
        });
    });

    describe('io-package.json', () => {
        let ioPackageJson;

        before(() => {
            const ioPackagePath = path.join(__dirname, '../../io-package.json');
            ioPackageJson = JSON.parse(fs.readFileSync(ioPackagePath, 'utf8'));
        });

        it('should have common section', () => {
            expect(ioPackageJson.common).to.be.an('object');
        });

        it('should have matching name with package.json', () => {
            expect(ioPackageJson.common.name).to.equal('mcdu');
        });

        it('should have a valid version', () => {
            expect(ioPackageJson.common.version).to.match(/^\d+\.\d+\.\d+$/);
        });

        it('should have version matching package.json', () => {
            const packageJson = JSON.parse(
                fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8')
            );
            expect(ioPackageJson.common.version).to.equal(packageJson.version);
        });

        it('should have title and description', () => {
            expect(ioPackageJson.common.title).to.be.a('string');
            expect(ioPackageJson.common.desc).to.be.an('object');
            expect(ioPackageJson.common.desc.en).to.be.a('string');
        });

        it('should have required metadata', () => {
            expect(ioPackageJson.common.type).to.equal('hardware');
            expect(ioPackageJson.common.mode).to.equal('daemon');
            expect(ioPackageJson.common.platform).to.equal('Javascript/Node.js');
        });

        it('should have authors array', () => {
            expect(ioPackageJson.common.authors).to.be.an('array');
            expect(ioPackageJson.common.authors.length).to.be.greaterThan(0);
        });

        it('should have keywords', () => {
            expect(ioPackageJson.common.keywords).to.be.an('array');
            expect(ioPackageJson.common.keywords.length).to.be.greaterThan(0);
        });

        it('should have native section', () => {
            expect(ioPackageJson.native).to.be.an('object');
        });

        it('should have objects section', () => {
            expect(ioPackageJson.objects).to.be.an('array');
        });

        it('should have instanceObjects section', () => {
            expect(ioPackageJson.instanceObjects).to.be.an('array');
        });

        it('should have news section with version history', () => {
            expect(ioPackageJson.common.news).to.be.an('object');
            const latestVersion = ioPackageJson.common.version;
            expect(ioPackageJson.common.news).to.have.property(latestVersion);
        });
    });

    describe('LICENSE file', () => {
        it('should exist', () => {
            const licensePath = path.join(__dirname, '../../LICENSE');
            expect(fs.existsSync(licensePath)).to.be.true;
        });

        it('should be MIT license', () => {
            const licensePath = path.join(__dirname, '../../LICENSE');
            const licenseContent = fs.readFileSync(licensePath, 'utf8');
            expect(licenseContent).to.include('MIT License');
        });
    });

    describe('README.md file', () => {
        it('should exist', () => {
            const readmePath = path.join(__dirname, '../../README.md');
            expect(fs.existsSync(readmePath)).to.be.true;
        });

        it('should have content', () => {
            const readmePath = path.join(__dirname, '../../README.md');
            const readmeContent = fs.readFileSync(readmePath, 'utf8');
            expect(readmeContent.length).to.be.greaterThan(100);
        });

        it('should mention adapter name', () => {
            const readmePath = path.join(__dirname, '../../README.md');
            const readmeContent = fs.readFileSync(readmePath, 'utf8');
            expect(readmeContent.toLowerCase()).to.include('mcdu');
        });
    });

    describe('CHANGELOG.md file', () => {
        it('should exist', () => {
            const changelogPath = path.join(__dirname, '../../CHANGELOG.md');
            expect(fs.existsSync(changelogPath)).to.be.true;
        });
    });

    describe('Admin UI files', () => {
        it('should have jsonConfig.json', () => {
            const configPath = path.join(__dirname, '../../admin/jsonConfig.json');
            expect(fs.existsSync(configPath)).to.be.true;
        });

        it('should have valid jsonConfig.json', () => {
            const configPath = path.join(__dirname, '../../admin/jsonConfig.json');
            const configContent = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            expect(configContent).to.be.an('object');
        });

        it('should have translation files', () => {
            const enPath = path.join(__dirname, '../../admin/i18n/en/translations.json');
            const dePath = path.join(__dirname, '../../admin/i18n/de/translations.json');
            expect(fs.existsSync(enPath)).to.be.true;
            expect(fs.existsSync(dePath)).to.be.true;
        });
    });
});
