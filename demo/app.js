const initial = [
  { id: 1, title: "梳理新版首屏的信息层级", tag: "设计", urgent: true, done: false, meta: "今天 18:00 前" },
  { id: 2, title: "补齐实时预览的选择模式", tag: "开发", urgent: false, done: false, meta: "进行中 · 60%" },
  { id: 3, title: "整理本周用户访谈记录", tag: "研究", urgent: false, done: true, meta: "已完成 · 昨天" },
  { id: 4, title: "确认安卓打包签名流程", tag: "发布", urgent: true, done: false, meta: "等待确认" },
]

let tasks = [...initial]
let filter = "all"

const board = document.getElementById("board")
const input = document.getElementById("task-input")
const addButton = document.getElementById("add-task")
const tabs = {
  all: document.getElementById("tab-all"),
  open: document.getElementById("tab-open"),
  done: document.getElementById("tab-done"),
}

function visible() {
  if (filter === "open") return tasks.filter((task) => !task.done)
  if (filter === "done") return tasks.filter((task) => task.done)
  return tasks
}

function render() {
  board.innerHTML = ""
  for (const task of visible()) {
    const card = document.createElement("article")
    card.className = `card${task.done ? " done" : ""}`
    card.dataset.taskId = String(task.id)

    const head = document.createElement("div")
    head.className = "card-head"
    const tag = document.createElement("span")
    tag.className = `tag${task.urgent ? " urgent" : ""}`
    tag.textContent = task.tag
    const meta = document.createElement("span")
    meta.className = "meta"
    meta.textContent = task.done ? "已完成" : "待办"
    head.append(tag, meta)

    const title = document.createElement("h3")
    title.className = "title"
    title.textContent = task.title

    const detail = document.createElement("p")
    detail.className = "meta"
    detail.textContent = task.meta

    const actions = document.createElement("div")
    actions.className = "actions"
    const toggle = document.createElement("button")
    toggle.className = "ghost"
    toggle.textContent = task.done ? "恢复任务" : "标记完成"
    toggle.addEventListener("click", () => {
      task.done = !task.done
      render()
    })
    const remove = document.createElement("button")
    remove.className = "ghost danger"
    remove.textContent = "删除"
    remove.addEventListener("click", () => {
      tasks = tasks.filter((item) => item.id !== task.id)
      render()
    })
    actions.append(toggle, remove)

    card.append(head, title, detail, actions)
    board.appendChild(card)
  }

  if (visible().length === 0) {
    const empty = document.createElement("p")
    empty.className = "meta"
    empty.textContent = "这里还没有任务。"
    board.appendChild(empty)
  }
}

function setFilter(next) {
  filter = next
  for (const [name, button] of Object.entries(tabs)) {
    const active = name === next
    button.classList.toggle("active", active)
    button.setAttribute("aria-selected", String(active))
  }
  render()
}

for (const [name, button] of Object.entries(tabs)) {
  button.addEventListener("click", () => setFilter(name))
}

function addTask() {
  const text = input.value.trim()
  if (text.length === 0) return
  tasks = [
    { id: Date.now(), title: text, tag: "新任务", urgent: false, done: false, meta: "刚刚创建" },
    ...tasks,
  ]
  input.value = ""
  render()
}

addButton.addEventListener("click", addTask)
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter") addTask()
})

render()
