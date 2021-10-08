#!/usr/bin/env node
const core = require('@actions/core');
const github = require('@actions/github');
const axios = require('axios').default;

try {
  const env = {
    apiKey: process.env['TRELLO_API_KEY'],
    apiToken: process.env['TRELLO_API_TOKEN'],
    boardId: process.env['TRELLO_BOARD_ID'],
    todoListId: process.env['TRELLO_TODO_LIST_ID'],
    doneListId: process.env['TRELLO_DONE_LIST_ID'],
    memberMap: JSON.parse(process.env['TRELLO_MEMBER_MAP'])
    .map(row => row.toLowerCase())
    .map(row => row.split(":"))
    .reduce((map, data) => map[data[0]] = data[1], {}),
  };

  const action = core.getInput('trello-action');
  console.log('Action:', action);
  console.log(env.memberMap);
  switch (action) {
    case 'create_card_when_issue_opened':
      createCard(env);
      break;
    case 'modify_card_when_issue_edited':
      editCard(env);
      break;
    case 'move_card_when_issue_closed':
      closeCard(env);
      break;
  }
} catch (error) {
  console.error('Error', error);
  core.setFailed(error.message);
}

function call(env, path, method, body = {}) {
  const instance = axios.create({
    baseURL: 'https://api.trello.com/1',
    params: {
      key: env.apiKey,
      token: env.apiToken
    },
    headers: {
      'Content-Type': 'application/json'
    },
  });

  console.log("Request: " + JSON.stringify(body));

  return instance.request({
    url: path,
    method: method,
    data: body,
  })
  .then((response) => response.data);
}

async function createCard(env) {
  const issue = github.context.payload.issue

  const labelIds = await getLabelIds(env, issue.labels);
  const memberIds = await getMemberIds(env, issue.assignees);
  console.log("assignees: " + memberIds.join());

  call(env, "/cards", "POST", {
    'idList': env.todoListId,
    'keepFromSource': 'all',
    'name': `[#${issue.number}] ${issue.title}`,
    'desc': issue.body,
    'urlSource': issue.html_url,
    'idMembers': memberIds.join(),
    'idLabels': labelIds.join(),
    'pos': 'bottom',
  });
}

async function editCard(env) {
  const issue = github.context.payload.issue
  const number = issue.number;

  const labelIds = await getLabelIds(env, issue.labels);
  const memberIds = await getMemberIds(env, issue.assignees);
  console.log("assignees: " + memberIds.join());

  const existsCard = await getCards(env)
  .then(data => data.filter(card => card.name.startsWith(`[#${issue.number}]`)));

  if (existsCard.length === 0) {
    throw new Error("Card cannot Found");
  }

  call(env, `/cards/${existsCard[0].id}`, "PUT", {
    'name': `[#${number}] ${issue.title}`,
    'desc': issue.body,
    'urlSource': issue.html_url,
    'idMembers': memberIds.join(),
    'idLabels': labelIds.join(),
  });
}

async function closeCard(env) {
  const issue = github.context.payload.issue

  const existsCard = await getCards(env)
  .then(data => data.filter(card => card.name.startsWith(`[#${issue.number}]`)));

  if (existsCard.length === 0) {
    throw new Error("Card cannot Found");
  }

  call(env, `/cards/${existsCard[0].id}`, "PUT", {
    idList: env.doneListId
  });
}

function getLabelIds(env, labels) {
  return call(env, `/boards/${env.boardId}/labels`, "GET")
  .then(data => {
    return labels
    .map(label => label.name)
    .map(labelName => data.find(each => each.name === labelName))
    .filter(trelloLabel => Boolean(trelloLabel))
    .map(trelloLabel => trelloLabel.id)
  });
}

function getMemberIds(env, assignees) {
  return call(env, `/boards/${env.boardId}/members`, "GET")
  .then(data => {
    return assignees
    .map(assignee => env.memberMap[assignee.login.toLowerCase()])
    .map(assignee => data.find(each => each.username.toLowerCase() === assignee))
    .filter(member => Boolean(member))
    .map(member => member.id);
  });
}

function getCards(env) {
  return call(env, `/boards/${env.boardId}/cards`, "GET");
}