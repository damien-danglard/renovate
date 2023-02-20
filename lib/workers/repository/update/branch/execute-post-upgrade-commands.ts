// TODO #7154
import is from '@sindresorhus/is';
import { GlobalConfig } from '../../../../config/global';
import { addMeta, logger } from '../../../../logger';
import type { BranchConfig, BranchUpgradeConfig } from '../../../types';
import {
  UpgradeCommandsExecutionResult,
  upgradeTaskExecutor,
} from './execute-upgrade-commands';

export async function postUpgradeCommandsExecutor(
  filteredUpgradeCommands: BranchUpgradeConfig[],
  config: BranchConfig
): Promise<UpgradeCommandsExecutionResult> {
  const updatedArtifacts = [...(config.updatedArtifacts ?? [])];
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
    const upgradeTask = upgrade.postUpgradeTasks;
    const result = await upgradeTaskExecutor(
      upgradeTask,
      config,
      updatedArtifacts,
      allowedUpgradeCommands,
      allowUpgradeCommandTemplating,
      upgrade,
      'Post-upgrade'
    );
    updatedArtifacts.concat(result.updatedArtifacts);
    artifactErrors.concat(result.artifactErrors);
  }
  return { updatedArtifacts, artifactErrors };
}

export default async function executePostUpgradeCommands(
  config: BranchConfig
): Promise<UpgradeCommandsExecutionResult | null> {
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
