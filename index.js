#!/usr/bin/env node
const core = require('@actions/core');
const github = require('@actions/github');
const request = require('request-promise-native');

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

function call(env, path, method, body) {
  let req = {
    method: method,
    url: `https://api.trello.com/1${path}?key=${env.apiKey}&token=${env.apiToken}`,
    json: true
  };

  console.log("URL: " + req.url);
  console.log("Body: " + body);

  if (body) {
    req = {
      form: body,
      ...req,
    }
  }

  return new Promise(function (resolve, reject) {
    request(req)
    .then(function (body) {
      resolve(body);
    })
    .catch(function (error) {
      reject(error);
    })
  });
}

async function createCard(env) {
  const issue = github.context.payload.issue

  const labelIds = await getLabelIds(env, issue.labels);
  const memberIds = await getMemberIds(env, issue.assignees);

  call(env, "/cards", "POST", {
    'idList': env.todoListId,
    'keepFromSource': 'all',
    'name': `[#${issue.number}] ${issue.title}`,
    'desc': issue.description,
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

  const cardId = await getCards(env)
  .then(function (response) {
    return response.find(card => card.name.startsWith(`[#${number}]`))
    .map(card => card.id);
  });

  if (!cardId) {
    throw new Error("Card cannot Found");
  }

  call(env, `/cards/${cardId}`, "PUT", {
    'name': `[#${number}] ${issue.title}`,
    'desc': issue.description,
    'urlSource': issue.html_url,
    'idMembers': memberIds.join(),
    'idLabels': labelIds.join(),
  });
}

async function closeCard(env) {
  const issue = github.context.payload.issue

  const cardId = await getCards(env)
  .then(function (response) {
    return response.find(card => card.name.startsWith(`[#${issue.number}]`))
    .map(card => card.id);
  });

  if (!cardId) {
    throw new Error("Card cannot Found");
  }

  call(env, `/cards/${cardId}`, "PUT", {
    destinationListId: env.doneListId
  });
}

function getLabelIds(env, labels) {
  return call(env, `/boards/${env.boardId}/labels`, "GET")
  .then((body) => JSON.parse(body))
  .then(trelloLabels => {
    return labels
    .map(label => label.name)
    .map(labelName => trelloLabels.find(
        trelloLabel => trelloLabel.name === labelName))
    .map(trelloLabel => trelloLabel.id)
  });
}

function getMemberIds(env, assignees) {
  return call(env, `/boards/${env.boardId}/members`, "GET")
  .then((body) => JSON.parse(body))
  .then(trelloMembers => {
    return assignees
    .map(assignee => env.memberMap[assignee.login.toLowerCase()])
    .map(assignee => trelloMembers.find(
        member => member.username.toLowerCase() === assignee))
    .filter(member => Boolean(member))
    .map(member => member.id);
  });
}

function getCards(env) {
  return call(env, `/boards/${env.boardId}/cards`, "GET")
  .then((body) => JSON.parse(body));
}

function removeCover(apiKey, apiToken, cardId) {
  const options = {
    method: "PUT",
    url: `https://api.trello.com/1/cards/${cardId}?key=${apiKey}&token=${apiToken}`,
    form: {
      "idAttachmentCover": null
    }
  }
  return new Promise(function (resolve, reject) {
    request(options)
    .then(function (body) {
      resolve(JSON.parse(body));
    })
    .catch(function (error) {
      reject(error);
    })
  });
}

function addUrlSourceToCard(apiKey, apiToken, cardId, url) {
  const options = {
    method: "POST",
    url: `https://api.trello.com/1/cards/${cardId}/attachments?key=${apiKey}&token=${apiToken}`,
    form: {
      url: url
    }
  }
  return new Promise(function (resolve, reject) {
    request(options)
    .then(function (body) {
      resolve(JSON.parse(body));
    })
    .catch(function (error) {
      reject(error);
    })
  });
}
