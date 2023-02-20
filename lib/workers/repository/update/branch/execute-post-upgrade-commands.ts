// TODO #7154
import is from '@sindresorhus/is';
import { GlobalConfig } from '../../../../config/global';
import { addMeta, logger } from '../../../../logger';
import type { ArtifactError } from '../../../../modules/manager/types';
import type { FileChange } from '../../../../util/git/types';
import type { BranchConfig, BranchUpgradeConfig } from '../../../types';
import {
  persistUpdatedFiles,
  updateUpdatedArtifacts,
  upgradeCommandExecutor,
} from './execute-upgrade-commands';

export interface PostUpgradeCommandsExecutionResult {
  updatedArtifacts: FileChange[];
  artifactErrors: ArtifactError[];
}

export async function postUpgradeCommandsExecutor(
  filteredUpgradeCommands: BranchUpgradeConfig[],
  config: BranchConfig
): Promise<PostUpgradeCommandsExecutionResult> {
  let updatedArtifacts = [...(config.updatedArtifacts ?? [])];
  const artifactErrors = [...(config.artifactErrors ?? [])];
  const { allowedUpgradeCommands, allowUpgradeCommandTemplating } =
    GlobalConfig.get();

  for (const upgrade of filteredUpgradeCommands) {
    addMeta({ dep: upgrade.depName });
    logger.trace(
      {
        tasks: upgrade.postUpgradeTasks,
        allowedCommands: allowedUpgradeCommands,
      },
      `Checking for post-upgrade tasks`
    );
    const commands = upgrade.postUpgradeTasks?.commands ?? [];
    const fileFilters = upgrade.postUpgradeTasks?.fileFilters ?? [];
    if (is.nonEmptyArray(commands)) {
      // Persist updated files in file system so any executed commands can see them
      const filesToPersist =
        config.updatedPackageFiles!.concat(updatedArtifacts);
      await persistUpdatedFiles(filesToPersist);

      for (const cmd of commands) {
        const commandError = await upgradeCommandExecutor(
          allowedUpgradeCommands ?? [],
          cmd,
          allowUpgradeCommandTemplating,
          config,
          upgrade,
          'Post-upgrade'
        );
        artifactErrors.concat(commandError);
      }

      updatedArtifacts = await updateUpdatedArtifacts(
        fileFilters,
        updatedArtifacts,
        'Post-upgrade'
      );
    }
  }
  return { updatedArtifacts, artifactErrors };
}

export default async function executePostUpgradeCommands(
  config: BranchConfig
): Promise<PostUpgradeCommandsExecutionResult | null> {
  const { allowedUpgradeCommands } = GlobalConfig.get();

  const hasChangedFiles =
    (config.updatedPackageFiles && config.updatedPackageFiles.length > 0) ||
    (config.updatedArtifacts && config.updatedArtifacts.length > 0);

  if (
    /* Only run post-upgrade tasks if there are changes to package files... */
    !hasChangedFiles ||
    is.emptyArray(allowedUpgradeCommands)
  ) {
    return null;
  }

  const branchUpgradeCommands: BranchUpgradeConfig[] = [
    {
      manager: config.manager,
      depName: config.upgrades.map(({ depName }) => depName).join(' '),
      branchName: config.branchName,
      postUpgradeTasks:
        config.postUpgradeTasks!.executionMode === 'branch'
          ? config.postUpgradeTasks
          : undefined,
      fileFilters: config.fileFilters,
    },
  ];

  const updateUpgradeCommands: BranchUpgradeConfig[] = config.upgrades.filter(
    ({ postUpgradeTasks }) =>
      !postUpgradeTasks?.executionMode ||
      postUpgradeTasks.executionMode === 'update'
  );

  const { updatedArtifacts, artifactErrors } =
    await postUpgradeCommandsExecutor(updateUpgradeCommands, config);
  return postUpgradeCommandsExecutor(branchUpgradeCommands, {
    ...config,
    updatedArtifacts,
    artifactErrors,
  });
}
