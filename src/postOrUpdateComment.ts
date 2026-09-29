/**
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { endGroup, startGroup } from "@actions/core";
import type { GitHub } from "@actions/github/lib/utils";
import { Context } from "@actions/github/lib/context";
import { ChannelSuccessResult, interpretChannelDeployResult } from "./deploy";
import { createDeploySignature } from "./hash";

const BOT_SIGNATURE =
  "<sub>🔥 via [Firebase Hosting GitHub Action](https://github.com/marketplace/actions/deploy-to-firebase-hosting) 🌎</sub>";

export function createBotCommentIdentifier(signature: string) {
  return function isCommentByBot(comment): boolean {
    return comment.user.type === "Bot" && comment.body.includes(signature);
  };
}

/**
 * ScheduLearn's staging previews also answer at `<name>.preview.schedulearn.com`, through a
 * CloudFront proxy. Only that address can use the passkeys made on ScheduLearn's real sites, so the
 * comment links there instead of to `web.app`.
 */
const SCHEDULEARN_PREVIEW_URL =
  /^https:\/\/schedulearn-app-staging--([a-z0-9-]+)\.web\.app\/?$/;

export function toScheduLearnPreviewURL(url: string): string {
  const match = SCHEDULEARN_PREVIEW_URL.exec(url);
  return match ? `https://${match[1]}.preview.schedulearn.com` : url;
}

export function getURLsMarkdownFromChannelDeployResult(
  result: ChannelSuccessResult
): string {
  const urls = interpretChannelDeployResult(result).urls.map(
    toScheduLearnPreviewURL
  );

  return urls.length === 1
    ? `[${urls[0]}](${urls[0]})`
    : urls.map((url) => `- [${url}](${url})`).join("\n");
}

export function getChannelDeploySuccessComment(
  result: ChannelSuccessResult,
  commit: string
) {
  const deploySignature = createDeploySignature(result);
  const urlList = getURLsMarkdownFromChannelDeployResult(result);
  const { expire_time_formatted } = interpretChannelDeployResult(result);

  return `
Visit the preview URL for this PR (updated for commit ${commit}):

${urlList}

<sub>(expires ${expire_time_formatted})</sub>

${BOT_SIGNATURE}

<sub>Sign: ${deploySignature}</sub>`.trim();
}

export async function postChannelSuccessComment(
  github: InstanceType<typeof GitHub>,
  context: Context,
  result: ChannelSuccessResult,
  commit: string
) {
  const commentInfo = {
    ...context.repo,
    issue_number: context.issue.number,
  };

  const commentMarkdown = getChannelDeploySuccessComment(result, commit);

  const comment = {
    ...commentInfo,
    body: commentMarkdown,
  };

  startGroup(`Commenting on PR`);
  const deploySignature = createDeploySignature(result);
  const isCommentByBot = createBotCommentIdentifier(deploySignature);

  let commentId;
  try {
    const comments = (await github.rest.issues.listComments(commentInfo)).data;
    for (let i = comments.length; i--; ) {
      const c = comments[i];
      if (isCommentByBot(c)) {
        commentId = c.id;
        break;
      }
    }
  } catch (e) {
    console.log("Error checking for previous comments: " + e.message);
  }

  if (commentId) {
    try {
      await github.rest.issues.updateComment({
        ...context.repo,
        comment_id: commentId,
        body: comment.body,
      });
    } catch (e) {
      commentId = null;
    }
  }

  if (!commentId) {
    try {
      await github.rest.issues.createComment(comment);
    } catch (e) {
      console.log(`Error creating comment: ${e.message}`);
    }
  }
  endGroup();
}
