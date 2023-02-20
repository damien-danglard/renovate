import is from '@sindresorhus/is';
import { GlobalConfig } from '../../../../config/global';
import { addMeta, logger } from '../../../../logger';
import type { BranchConfig, BranchUpgradeConfig } from '../../../types';
import {
  UpgradeCommandsExecutionResult,
  upgradeTaskExecutor,
} from './execute-upgrade-commands';

export async function preUpgradeCommandsExecutor(
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
        tasks: upgrade.preUpgradeTasks,
        allowedCommands: allowedUpgradeCommands,
      },
      `Checking for pre-upgrade tasks`
    );
    const upgradeTask = upgrade.preUpgradeTasks;
    const result = await upgradeTaskExecutor(
      upgradeTask,
      config,
      updatedArtifacts,
      allowedUpgradeCommands,
      allowUpgradeCommandTemplating,
      upgrade
    );
    updatedArtifacts.concat(result.updatedArtifacts);
    artifactErrors.concat(result.artifactErrors);
  }
  return { updatedArtifacts, artifactErrors };
}

export default async function executePreUpgradeCommands(
  config: BranchConfig
): Promise<UpgradeCommandsExecutionResult | null> {
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
