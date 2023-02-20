import is from '@sindresorhus/is';
import { mergeChildConfig } from '../../../../config';
import { GlobalConfig } from '../../../../config/global';
import { addMeta, logger } from '../../../../logger';
import type { ArtifactError } from '../../../../modules/manager/types';
import { exec } from '../../../../util/exec';
import { localPathIsFile, writeLocalFile } from '../../../../util/fs';
import type { FileChange } from '../../../../util/git/types';
import { regEx } from '../../../../util/regex';
import { sanitize } from '../../../../util/sanitize';
import { compile } from '../../../../util/template';
import type { BranchConfig, BranchUpgradeConfig } from '../../../types';
import { updateUpdatedArtifacts } from './execute-upgrade-commands';

export interface PreUpgradeCommandsExecutionResult {
  updatedArtifacts: FileChange[];
  artifactErrors: ArtifactError[];
}

export async function preUpgradeCommandsExecutor(
  filteredUpgradeCommands: BranchUpgradeConfig[],
  config: BranchConfig
): Promise<PreUpgradeCommandsExecutionResult> {
  let updatedArtifacts = [...(config.updatedArtifacts ?? [])];
  const artifactErrors = [...(config.artifactErrors ?? [])];
  const { allowedUpgradeCommands, allowUpgradeCommandTemplating } =
    GlobalConfig.get();

  for (const upgrade of filteredUpgradeCommands) {
    addMeta({ dep: upgrade.depName });
    logger.trace(
      {
        tasks: upgrade.preUpgradeTasks,
        allowedCommands: allowedUpgradeCommands,
      },
      `Checking for pre-upgrade tasks`
    );
    const commands = upgrade.preUpgradeTasks?.commands ?? [];
    const fileFilters = upgrade.preUpgradeTasks?.fileFilters ?? [];
    if (is.nonEmptyArray(commands)) {
      // Persist updated files in file system so any executed commands can see them
      for (const file of (config.updatedPackageFiles ?? []).concat(
        updatedArtifacts
      )) {
        const canWriteFile = await localPathIsFile(file.path);
        if (file.type === 'addition' && canWriteFile) {
          let contents: Buffer | null;
          if (typeof file.contents === 'string') {
            contents = Buffer.from(file.contents);
          } else {
            contents = file.contents;
          }
          await writeLocalFile(file.path, contents!);
        }
      }

      for (const cmd of commands) {
        if (
          allowedUpgradeCommands!.some((pattern) => regEx(pattern).test(cmd))
        ) {
          try {
            const compiledCmd = allowUpgradeCommandTemplating
              ? compile(cmd, mergeChildConfig(config, upgrade))
              : cmd;

            logger.trace({ cmd: compiledCmd }, 'Executing pre-upgrade task');
            const execResult = await exec(compiledCmd, {
              cwd: GlobalConfig.get('localDir'),
            });

            logger.debug(
              { cmd: compiledCmd, ...execResult },
              'Executed pre-upgrade task'
            );
          } catch (error) {
            artifactErrors.push({
              lockFile: upgrade.packageFile,
              stderr: sanitize(error.message),
            });
          }
        } else {
          logger.warn(
            {
              cmd,
              allowedUpgradeCommands,
            },
            'Pre-upgrade task did not match any on allowedUpgradeCommands list'
          );
          artifactErrors.push({
            lockFile: upgrade.packageFile,
            stderr: sanitize(
              `Pre-upgrade command '${cmd}' has not been added to the allowed list in allowedUpgradeCommands`
            ),
          });
        }
      }

      updatedArtifacts = await updateUpdatedArtifacts(
        fileFilters,
        updatedArtifacts
      );
    }
  }
  return { updatedArtifacts, artifactErrors };
}

export default async function executePreUpgradeCommands(
  config: BranchConfig
): Promise<PreUpgradeCommandsExecutionResult | null> {
  const { allowedUpgradeCommands } = GlobalConfig.get();

  if (is.emptyArray(allowedUpgradeCommands)) {
    return null;
  }

  const branchUpgradeCommands: BranchUpgradeConfig[] = [
    {
      manager: config.manager,
      depName: config.upgrades.map(({ depName }) => depName).join(' '),
      branchName: config.branchName,
      preUpgradeTasks:
        config.preUpgradeTasks!.executionMode === 'branch'
          ? config.preUpgradeTasks
          : undefined,
      fileFilters: config.fileFilters,
    },
  ];

  const updateUpgradeCommands: BranchUpgradeConfig[] = config.upgrades.filter(
    ({ preUpgradeTasks }) =>
      !preUpgradeTasks?.executionMode ||
      preUpgradeTasks.executionMode === 'update'
  );

  const { updatedArtifacts, artifactErrors } = await preUpgradeCommandsExecutor(
    updateUpgradeCommands,
    config
  );
  return preUpgradeCommandsExecutor(branchUpgradeCommands, {
    ...config,
    updatedArtifacts,
    artifactErrors,
  });
}
