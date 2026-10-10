// Bridge between the game page and the desktop shell.
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("bountyDesktop", {
  listCards: () => ipcRenderer.invoke("cards:list"),
  artPut: (id, bytes, type) => ipcRenderer.invoke("art:put", id, bytes, type),
  artDelete: id => ipcRenderer.invoke("art:delete", id),
  artList: () => ipcRenderer.invoke("art:list"),
  hasKey: () => ipcRenderer.invoke("key:has"),
  setKey: key => ipcRenderer.invoke("key:set", key),
  sampleJson: (prompt, images) => ipcRenderer.invoke("sample:json", prompt, images),
  onKeyMenu: fn => ipcRenderer.on("ui:key", () => fn()),
  updateState: () => ipcRenderer.invoke("update:state"),
  checkForUpdate: () => ipcRenderer.invoke("update:check"),
  restartToUpdate: () => ipcRenderer.invoke("update:restart"),
  onUpdate: fn => ipcRenderer.on("ui:update", (_e, s) => fn(s))
});
