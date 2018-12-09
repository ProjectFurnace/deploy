import Build from "../src/Build";
import * as path from "path";
import * as fsUtils from "@project-furnace/fsutils";

describe('build', () => {

    beforeAll(() => {
        process.env.GIT_USERNAME = "";
        process.env.GIT_TOKEN = "";
    })


   describe('buildModule', () => {
    it('should successfully build module', async () => {
        
        let codePath = await fsUtils.createTempDirectory()
          , templatePath = await fsUtils.createTempDirectory()
          , buildPath = await fsUtils.createTempDirectory()
          ;

        fsUtils.writeFile(path.join(codePath, "codeFile"), "test");
        fsUtils.writeFile(path.join(templatePath, "templateFile"), "test");

        const artifact = await Build.buildModule( { name: "testModule", info: { runtime: "nodejs8.10" }  }, codePath, templatePath, buildPath);
        
        expect(artifact.length).toBeGreaterThan(0);
        expect(artifact.endsWith(".zip")).toBe(true);
        expect(fsUtils.exists(artifact)).toBe(true);

        fsUtils.rimraf(artifact);
        
    });
   });

    describe.only('buildStack', () => {
        it('should build stack', async () => {
            jest.setTimeout(20000);
            const result = await Build.buildStack(
                "test/fixtures/config",
                "test/fixtures/templates",
                "furnace-artifacts",
                "aws"
            );
            
        });
    });

    describe('validateModuleMetadata', () => {
        it('should return zero errors with valid module def', () => {
            const moduleDef = {
                info: {
                    runtime: "nodejs8.10"
                }
            };
            const result = Build.validateModuleMetadata(moduleDef);
            expect(result).toHaveLength(0);
        });

        it('should return 1 error with missing runtime', () => {
            const moduleDef = {
                info: {}
            };
            const result = Build.validateModuleMetadata(moduleDef);
            expect(result).toHaveLength(1);
        });
    });
});