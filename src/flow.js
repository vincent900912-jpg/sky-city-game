import { hasValidSave, resetForNewGame, writeSave } from './save.js';

export const STATES = Object.freeze({ BOOT: 'BOOT', OPENING: 'OPENING', MAIN_MENU: 'MAIN_MENU', INTRO_STORY: 'INTRO_STORY', GAMEPLAY: 'GAMEPLAY', PAUSED: 'PAUSED', GAME_OVER: 'GAME_OVER', VICTORY: 'VICTORY' });

export const STORY_SCENES = [
  { title: '天空文明', art: 'assets/opening/01-sereon-prosperity.png', beats: [
    '很久以前，天空文明「瑟雷昂」建立了一座漂浮於雲海之上的城市',
    '城市依靠「天穹核心」，調節風、重力與氣候',
    '風晶、星光與精密機械交織，成為支撐天空文明的「輝械技術」',
  ] },
  { title: '靜默日', art: 'assets/opening/02-silent-day.png', beats: [
    '某一天，天穹核心突然停止回應',
    '城市開始斷裂；後世將那一天稱為「靜默日」',
    '守護機械失去統一指令，開始把所有生命視為入侵者',
  ] },
  { title: '數百年後', art: 'assets/opening/03-centuries-later.png', beats: [
    '數百年後，地表的人們只知道：雲層之上，有一座會在暴風中發光的禁忌古城',
    '最近，城市碎片開始墜落，世界各地的風向也逐漸失去平衡',
  ] },
  { title: '澄羽', art: 'assets/opening/04-navigation-chip.png', beats: [
    '澄羽，十七歲的年輕遺跡探險者',
    '他熱愛未知遺跡，也相信自己終有一天能找到傳說中的寶藏，證明自己的能力',
  ] },
  { title: '導航晶片', art: 'assets/opening/04-navigation-chip.png', beats: [
    '某一天，一枚來自天空城市的導航晶片墜落地表',
    '晶片閃爍著不完整的座標，傳來幾乎被風聲吞沒的訊號',
    '「……核心……」\n「……雲門……」',
  ] },
  { title: '啟航', art: 'assets/opening/05-departure.png', beats: [
    '澄羽決定前往天空城市',
    '他駕駛親手製作的風帆艇升空，帶著折光刃與翼環，闖入厚重雲層',
    '雷光照亮風帆，翼環在狂風中啟動',
  ] },
  { title: '雲門階庭', art: 'assets/opening/06-cloud-reveal.png', beats: [
    '穿越最後一道暴風，巨大的天空城市從雲後出現',
    '飛艇接近城市外環；沉睡數百年的守護機械，再次亮起核心',
    '澄羽降落在——「雲門階庭」',
  ] },
];

export class FlowController {
  constructor(game) {
    this.game = game; this.sceneIndex = 0; this.beatIndex = 0; this.openingTimer = 0; this.confirming = false;
    this.opening = document.getElementById('opening-screen'); this.menu = document.getElementById('main-menu'); this.story = document.getElementById('story-screen'); this.chapter = document.getElementById('chapter-card');
    this.storyArt = document.getElementById('story-art'); this.storyTitle = document.getElementById('story-title'); this.storyText = document.getElementById('story-text'); this.storyNumber = document.getElementById('story-scene-number'); this.storyProgress = document.getElementById('story-progress'); this.fade = document.getElementById('fade-transition'); this.confirm = document.getElementById('confirm');
    this.bind();
  }
  bind() {
    this.opening.addEventListener('pointerdown', () => this.skipOpening());
    document.querySelectorAll('[data-flow]').forEach((button) => button.addEventListener('click', () => this.command(button.dataset.flow)));
    document.getElementById('story-next').addEventListener('click', () => this.nextStory()); document.getElementById('story-skip').addEventListener('click', () => this.requestSkipStory());
    this.story.addEventListener('pointerdown', (event) => { if (['story-art', 'story-pan', 'story-vignette'].includes(event.target.id) || event.target.classList.contains('story-vignette')) this.nextStory(); });
    document.addEventListener('keydown', (event) => {
      if (this.game.state === STATES.OPENING) { event.preventDefault(); this.skipOpening(); }
      else if (this.game.state === STATES.INTRO_STORY && !this.confirming && ['Space', 'Enter'].includes(event.code)) { event.preventDefault(); this.nextStory(); }
    }, { passive: false });
  }
  start() {
    this.game.setState(STATES.OPENING); this.showOnly(this.opening); sessionStorage.setItem('skyCityOpeningSeen', '1');
    this.openingTimer = setTimeout(() => this.showMenu(), 10000);
  }
  showOnly(element) { [this.opening, this.menu, this.story, this.chapter].forEach((node) => { node.hidden = node !== element; }); }
  async transition(work) { this.fade.classList.add('active'); await new Promise((resolve) => setTimeout(resolve, 360)); work(); await new Promise((resolve) => setTimeout(resolve, 50)); this.fade.classList.remove('active'); }
  skipOpening() { if (this.game.state !== STATES.OPENING) return; clearTimeout(this.openingTimer); this.showMenu(); }
  showMenu() {
    if (this.game.state === STATES.MAIN_MENU && !this.menu.hidden) return; clearTimeout(this.openingTimer); this.game.setState(STATES.MAIN_MENU); this.transition(() => { this.game.prepareMainMenu(); this.showOnly(this.menu); this.refreshMenu(); });
  }
  refreshMenu() {
    const valid = hasValidSave(); const button = document.getElementById('continue-button'); button.disabled = !valid;
    document.getElementById('menu-save-note').textContent = valid ? (this.game.save.level01Complete ? '第一關已通關・可繼續探索紀錄' : this.game.save.checkpoint ? '已找到雲門階庭的檢查點紀錄' : '已找到冒險紀錄') : '尚無冒險紀錄';
  }
  command(command) {
    if (command === 'new-game') this.requestNewGame(); else if (command === 'continue') this.continueGame(); else if (command === 'help' || command === 'settings') this.game.openOverlay(command);
  }
  requestNewGame() {
    if (!hasValidSave()) { this.beginNewGame(); return; }
    this.ask('開始新遊戲？', '開始新遊戲將覆蓋目前的關卡進度。鍵位與設定會保留。', '開始新遊戲', () => this.beginNewGame());
  }
  beginNewGame() { resetForNewGame(this.game.save); this.game.resetGameplayFromSave(); this.startStory(); }
  continueGame() { if (!hasValidSave()) return; if (this.game.save.introCompleted) this.game.enterGameplay(true); else this.startStory(); }
  startStory() { this.sceneIndex = 0; this.beatIndex = 0; this.game.setState(STATES.INTRO_STORY); this.transition(() => { this.showOnly(this.story); this.renderStory(); }); }
  renderStory() {
    const scene = STORY_SCENES[this.sceneIndex]; this.storyArt.src = scene.art; this.storyArt.alt = `${scene.title}序章插畫`; this.storyTitle.textContent = scene.title; this.storyText.textContent = scene.beats[this.beatIndex];
    this.storyNumber.textContent = `SCENE ${this.sceneIndex + 1} / ${STORY_SCENES.length}`; this.storyProgress.textContent = `${this.beatIndex + 1} / ${scene.beats.length}`;
    this.storyArt.style.animation = 'none'; void this.storyArt.offsetWidth; this.storyArt.style.animation = '';
    document.getElementById('story-next').textContent = this.sceneIndex === STORY_SCENES.length - 1 && this.beatIndex === scene.beats.length - 1 ? '進入第一章' : '下一段';
  }
  nextStory() {
    if (this.game.state !== STATES.INTRO_STORY || this.confirming) return; const scene = STORY_SCENES[this.sceneIndex];
    if (this.beatIndex < scene.beats.length - 1) this.beatIndex += 1; else if (this.sceneIndex < STORY_SCENES.length - 1) { this.sceneIndex += 1; this.beatIndex = 0; } else { this.completeStory(); return; }
    this.renderStory();
  }
  requestSkipStory() { if (this.game.state === STATES.INTRO_STORY) this.ask('跳過序章？', '序章將標記為已完成，並直接進入第一關。', '跳過', () => this.completeStory()); }
  completeStory() { this.game.save.introCompleted = true; writeSave(this.game.save); this.game.enterGameplay(false, true); }
  ask(title, text, acceptLabel, accept) {
    this.confirming = true; document.getElementById('confirm-title').textContent = title; document.getElementById('confirm-text').textContent = text; document.getElementById('confirm-accept').textContent = acceptLabel; this.confirm.classList.add('active');
    const close = () => { this.confirming = false; this.confirm.classList.remove('active'); cancel.onclick = null; okay.onclick = null; };
    const cancel = document.getElementById('confirm-cancel'); const okay = document.getElementById('confirm-accept'); cancel.onclick = close; okay.onclick = () => { close(); accept(); };
  }
  cancelConfirm() { if (!this.confirming) return false; document.getElementById('confirm-cancel').click(); return true; }
}
