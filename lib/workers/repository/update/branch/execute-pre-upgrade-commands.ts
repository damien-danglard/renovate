import is from '@sindresorhus/is';
import { GlobalConfig } from '../../../../config/global';
import { addMeta, logger } from '../../../../logger';
import type { ArtifactError } from '../../../../modules/manager/types';
import { localPathIsFile, writeLocalFile } from '../../../../util/fs';
import type { FileChange } from '../../../../util/git/types';
import type { BranchConfig, BranchUpgradeConfig } from '../../../types';
import {
  updateUpdatedArtifacts,
  upgradeCommandExecutor,
} from './execute-upgrade-commands';

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
        const commandError = await upgradeCommandExecutor(
          allowedUpgradeCommands ?? [],
          cmd,
          allowUpgradeCommandTemplating,
          config,
          upgrade
        );
        artifactErrors.concat(commandError);
      }

      updatedArtifacts = await updateUpdatedArtifacts(
        fileFilters,
        updatedArtifacts,
        'Pre-update'
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
