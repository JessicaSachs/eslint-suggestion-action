import {
  getBooleanInput,
  info,
  startGroup,
  endGroup,
  error,
  notice,
  warning,
} from "@actions/core";
import { getOctokit } from "./getOctokit";
import { getPushMetadata } from "./getPushMetadata";
import { getIndexedModifiedLines } from "./getIndexedModifiedLines";

type Octokit = import("@octokit/core").Octokit;
type Api = import("@octokit/plugin-rest-endpoint-methods/dist-types/types").Api;
type LintResult = import("eslint").ESLint.LintResult;
type RuleMetaData = import("eslint").Rule.RuleMetaData;

export async function getPushFiles(
  owner: string,
  repo: string,
  beforeSha: string,
  afterSha: string,
  octokit: Octokit & Api
) {
  const response = await octokit.rest.repos.compareCommitsWithBasehead({
    owner,
    repo,
    basehead: `${beforeSha}...${afterSha}`,
  });
  info(`Files: (${response.data.files?.length ?? 0})`);
  return response.data.files;
}

export async function pushEventHandler(
  indexedResults: {
    [file: string]: LintResult;
  },
  ruleMetaDatas: {
    [name: string]: RuleMetaData;
  }
) {
  const failCheck = getBooleanInput("fail-check");

  startGroup("GitHub Push");
  const octokit = getOctokit();
  const { owner, repo, beforeSha, afterSha } = await getPushMetadata();
  const files = await getPushFiles(owner, repo, beforeSha, afterSha, octokit);

  if (files === undefined || files.length === 0) {
    info(`Push contains no files`);
    return;
  }

  let warningCounter = 0;
  let errorCounter = 0;
  for (const file of files) {
    info(`  File name: ${file.filename}`);
    info(`  File status: ${file.status}`);
    if (file.status === "removed") {
      continue;
    }

    const indexedModifiedLines = getIndexedModifiedLines(file);

    const result = indexedResults[file.filename];
    if (result) {
      for (const message of result.messages) {
        if (message.ruleId === null || result.source === undefined) {
          continue;
        }
        const rule = ruleMetaDatas[message.ruleId];
        if (indexedModifiedLines[message.line]) {
          info(`  Matched line: ${message.line}`);
          switch (message.severity) {
            case 0:
              notice(
                `[${message.ruleId}]${message.message}: (${rule?.docs?.url})`,
                {
                  file: file.filename,
                  startLine: message.line,
                }
              );
              break;
            case 1:
              warning(
                `[${message.ruleId}]${message.message}: (${rule?.docs?.url})`,
                {
                  file: file.filename,
                  startLine: message.line,
                }
              );
              warningCounter++;
              break;
            case 2:
              error(
                `[${message.ruleId}]${message.message}: (${rule?.docs?.url})`,
                {
                  file: file.filename,
                  startLine: message.line,
                }
              );
              errorCounter++;
              break;
          }
        }
      }
    }
  }
  endGroup();

  startGroup("Feedback");
  if (warningCounter > 0 || errorCounter > 0) {
    if (failCheck) {
      throw new Error("ESLint fails. Please review comments.");
    } else {
      error("ESLint fails");
    }
  } else {
    info("ESLint passes");
  }
  endGroup();
}
