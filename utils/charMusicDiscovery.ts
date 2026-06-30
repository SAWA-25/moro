import { getCurrentSlot } from './charMusicSchedule';
import type {
  CharacterProfile,
  CharCurrentListening,
  CharMusicProfile,
  CharPlaylist,
  CharPlaylistSong,
  DailySchedule,
} from '../types';

export interface PlaylistSearchRequest {
  keyword: string;
  offset: number;
  weight: number;
  source: 'playlist' | 'artist' | 'genre' | 'interest' | 'mood' | 'recent' | 'schedule';
}

export interface PlaylistDiscoveryContext {
  currentListening?: CharCurrentListening | null;
  schedule?: DailySchedule | null;
  now?: Date;
}

export interface PlaylistSongCandidate {
  song: CharPlaylistSong;
  request: PlaylistSearchRequest;
  rank: number;
}

const MOOD_KEYWORDS: Record<string, string[]> = {
  happy: ['快乐', '明亮', '夏天'],
  sad: ['悲伤', '失眠', '雨天'],
  romantic: ['浪漫', '暧昧', '情歌'],
  angry: ['发泄', '摇滚', '后朋克'],
  chill: ['放松', 'lofi', '爵士'],
  epic: ['史诗', '燃', '电影感'],
  nostalgic: ['怀旧', 'city pop', '老歌'],
  dreamy: ['氛围', 'dream pop', 'ambient'],
};

const INTEREST_RULES: Array<{ re: RegExp; terms: string[] }> = [
  { re: /摄影|相机|胶片|拍照|影像/, terms: ['胶片', 'city pop', '独立民谣'] },
  { re: /写作|小说|诗|文学|书店|阅读|作家/, terms: ['民谣', '后摇', 'ambient'] },
  { re: /画画|绘画|美术|插画|设计|艺术|展览/, terms: ['dream pop', '独立流行', '艺术摇滚'] },
  { re: /咖啡|咖啡馆|烘焙|甜品|茶|书房/, terms: ['爵士', 'lofi', '轻音乐'] },
  { re: /游戏|电竞|RPG|主机|赛博|像素|二次元|动画|漫画/, terms: ['游戏音乐', '电子', 'J-rock'] },
  { re: /程序|代码|黑客|工程师|实验室|机械|机器人|AI|人工智能/, terms: ['synthwave', '电子', '氛围电子'] },
  { re: /舞台|偶像|唱跳|演出|直播|明星|练习生/, terms: ['K-pop', 'J-pop', 'dance pop'] },
  { re: /古风|武侠|江湖|修仙|仙侠|国风|琴|剑/, terms: ['古风', '国风', '中国风'] },
  { re: /海|海边|潮汐|雨|暴雨|水|雾|月亮|夜晚/, terms: ['氛围', 'dream pop', '后摇'] },
  { re: /跑步|健身|运动|篮球|赛车|机车|训练/, terms: ['摇滚', '电子', '燃'] },
  { re: /医院|医生|护士|诊所|药|治愈|照顾/, terms: ['治愈', '钢琴', '轻音乐'] },
  { re: /吸血鬼|暗黑|哥特|怪谈|悬疑|侦探|黑夜/, terms: ['dark wave', '后朋克', '哥特'] },
  { re: /温柔|慢热|安静|内向|独处|敏感|社恐/, terms: ['独立民谣', 'ambient', 'lofi'] },
  { re: /叛逆|毒舌|嘴硬|锋利|反抗|不服输/, terms: ['后朋克', '摇滚', '另类摇滚'] },
];

const GENERIC_TERMS = new Set([
  '角色', '用户', '自己', '对方', '喜欢', '爱好', '兴趣', '日常', '生活', '音乐', '歌单',
  '温柔', '性格', '设定', '世界观', '核心', '指令', '名字', '聊天', '朋友',
]);

const normalizeKey = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, ' ');

const clip = (value: string, max = 18): string => value.trim().replace(/\s+/g, ' ').slice(0, max);

const uniquePush = (target: string[], value: string) => {
  const cleaned = cleanTerm(value);
  if (!cleaned) return;
  const key = normalizeKey(cleaned);
  if (target.some(x => normalizeKey(x) === key)) return;
  target.push(cleaned);
};

const cleanTerm = (value: string): string => {
  const cleaned = value
    .replace(/[《》「」“”"'‘’()[\]{}]/g, '')
    .replace(/^(?:和|与|以及|还有|也|会|常常|经常|很|超|最|特别|有点|一点|一些)/, '')
    .replace(/(?:的人|的事|的时候|这件事|之类|等等)$/g, '')
    .trim();
  if (!cleaned || cleaned.length < 2 || cleaned.length > 24) return '';
  if (GENERIC_TERMS.has(cleaned)) return '';
  if (/用户|{{user}}|{{char}}|不要|禁止|必须/.test(cleaned)) return '';
  return clip(cleaned);
};

const splitTermFragment = (value: string): string[] => value
  .split(/[、,，/／;；|｜]|(?:\s+和\s+)|(?:\s+与\s+)|(?:以及)|(?:还有)/)
  .map(cleanTerm)
  .filter(Boolean);

const explicitInterestTerms = (text: string): string[] => {
  const terms: string[] = [];
  const patterns = [
    /(?:喜欢|爱好|热爱|沉迷|常看|常玩|常去|擅长|习惯|在意|钟情于)([^。！？\n；;]{2,36})/g,
    /(?:兴趣|爱好|日常|职业|专业|工作|生活方式|常去的地方)[:：是为\s]*([^。！？\n；;]{2,40})/g,
  ];

  for (const re of patterns) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      for (const term of splitTermFragment(match[1])) uniquePush(terms, term);
      if (terms.length >= 12) break;
    }
    if (terms.length >= 12) break;
  }
  return terms;
};

const collectContextTermsFromText = (text: string, limit = 8): string[] => {
  const terms: string[] = [];
  if (!text.trim()) return terms;
  for (const rule of INTEREST_RULES) {
    if (!rule.re.test(text)) continue;
    for (const term of rule.terms) uniquePush(terms, term);
  }
  for (const term of splitTermFragment(text)) uniquePush(terms, term);
  for (const term of explicitInterestTerms(text)) uniquePush(terms, term);
  return terms.slice(0, limit);
};

const collectRecentListeningTerms = (
  profile: CharMusicProfile,
  currentListening?: CharCurrentListening | null,
  limit = 10,
): string[] => {
  const terms: string[] = [];
  const plays = [...(profile.recentPlays || [])].sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 5);
  for (const play of plays) {
    uniquePush(terms, play.song?.name || '');
    uniquePush(terms, play.song?.artists || '');
    uniquePush(terms, play.song?.album || '');
    uniquePush(terms, play.context || '');
    if (play.song?.name && play.song?.artists) uniquePush(terms, `${play.song.name} ${play.song.artists}`);
    if (play.song?.artists && play.context) uniquePush(terms, `${play.song.artists} ${play.context}`);
  }
  if (profile.currentListening) {
    uniquePush(terms, profile.currentListening.songName || '');
    uniquePush(terms, profile.currentListening.artists || '');
    uniquePush(terms, profile.currentListening.vibe || '');
    if (profile.currentListening.songName && profile.currentListening.artists) {
      uniquePush(terms, `${profile.currentListening.songName} ${profile.currentListening.artists}`);
    }
  }
  if (currentListening) {
    uniquePush(terms, currentListening.songName || '');
    uniquePush(terms, currentListening.artists || '');
    uniquePush(terms, currentListening.vibe || '');
    if (currentListening.songName && currentListening.artists) {
      uniquePush(terms, `${currentListening.songName} ${currentListening.artists}`);
    }
  }
  return terms.slice(0, limit);
};

const SCHEDULE_MUSIC_HINTS: Array<{ re: RegExp; terms: string[] }> = [
  { re: /写作|写字|码字|阅读|看书|书店|图书馆/, terms: ['写作', '阅读', 'ambient', 'lofi', '钢琴'] },
  { re: /咖啡|咖啡馆|下午茶|茶馆|书房/, terms: ['咖啡馆', '爵士', 'lofi', '轻音乐'] },
  { re: /通勤|地铁|公交|开车|路上|车里|火车|高铁/, terms: ['通勤', 'city pop', '独立流行', '旅途'] },
  { re: /失眠|深夜|夜里|凌晨|熬夜|独处|放空/, terms: ['深夜', 'dream pop', '后摇', 'ambient'] },
  { re: /雨|下雨|暴雨|潮湿|雾/, terms: ['雨天', 'dream pop', '氛围', '后摇'] },
  { re: /运动|跑步|健身|训练|骑车|散步|徒步/, terms: ['运动', '电子', '摇滚', '燃'] },
  { re: /游戏|打怪|主机|RPG|开黑/, terms: ['游戏音乐', '电子', 'J-rock', '战斗感'] },
  { re: /约会|聚会|朋友|派对|看电影|散场/, terms: ['夜晚', 'R&B', 'city pop', 'dance pop'] },
  { re: /加班|工作|会议|上班|方案|赶稿|打工/, terms: ['工作', '办公', 'indie pop', '轻鼓点'] },
  { re: /做饭|吃饭|晚饭|宵夜|超市|买菜/, terms: ['生活', '温暖', '民谣', '轻快'] },
];

const collectScheduleContextTerms = (schedule?: DailySchedule | null, now: Date = new Date(), limit = 10): string[] => {
  const terms: string[] = [];
  const slot = getCurrentSlot(schedule || null, now);
  if (!slot) return terms;
  const blob = [slot.activity, slot.description, slot.location, slot.mood, slot.innerThought, slot.emoji]
    .filter(Boolean)
    .join(' ');
  uniquePush(terms, slot.activity || '');
  uniquePush(terms, slot.location || '');
  uniquePush(terms, slot.description || '');
  uniquePush(terms, slot.mood || '');
  uniquePush(terms, slot.innerThought || '');
  for (const rule of SCHEDULE_MUSIC_HINTS) {
    if (!rule.re.test(blob)) continue;
    for (const term of rule.terms) uniquePush(terms, term);
  }
  for (const term of collectContextTermsFromText(blob, limit)) uniquePush(terms, term);
  return terms.slice(0, limit);
};

const rotate = (arr: string[], offset: number, take: number): string[] => {
  if (arr.length === 0) return [];
  const out: string[] = [];
  for (let i = 0; i < take && i < arr.length; i++) out.push(arr[(offset + i) % arr.length]);
  return out;
};

const compactCharacterTasteText = (char: CharacterProfile): string => [
  char.systemPrompt,
  char.worldview,
  char.lifeProfile?.content,
  ...(char.selfInsights || []),
  ...(char.guidebookInsights || []),
  ...(char.memos || []).filter(m => !m.done).map(m => m.text),
  char.socialProfile?.bio,
].filter(Boolean).join('\n').slice(0, 5000);

export function collectCharacterMusicInterestTerms(char: CharacterProfile, limit = 12): string[] {
  const text = compactCharacterTasteText(char);
  const terms: string[] = [];

  for (const rule of INTEREST_RULES) {
    if (rule.re.test(text)) {
      for (const term of rule.terms) uniquePush(terms, term);
    }
  }
  for (const term of explicitInterestTerms(text)) uniquePush(terms, term);

  return terms.slice(0, limit);
}

export function buildPlaylistSearchRequests(
  char: CharacterProfile,
  profile: CharMusicProfile,
  playlist: CharPlaylist,
  context?: PlaylistDiscoveryContext,
): PlaylistSearchRequest[] {
  const plIndex = Math.max(0, profile.playlists.findIndex(p => p.id === playlist.id));
  const requests: PlaylistSearchRequest[] = [];
  const add = (
    keyword: string,
    source: PlaylistSearchRequest['source'],
    weight: number,
    offsetSeed = 0,
  ) => {
    const cleaned = cleanTerm(keyword);
    if (!cleaned) return;
    const key = normalizeKey(cleaned);
    if (requests.some(r => normalizeKey(r.keyword) === key)) return;
    requests.push({
      keyword: cleaned,
      source,
      weight,
      offset: Math.max(0, (offsetSeed % 3) * 10),
    });
  };

  const artists = profile.signatureArtists.map(a => a.name).filter(Boolean);
  const genres = profile.genreTags.filter(Boolean);
  const interests = collectCharacterMusicInterestTerms(char, 14);
  const recentTerms = collectRecentListeningTerms(profile, context?.currentListening, 10);
  const scheduleTerms = collectScheduleContextTerms(context?.schedule, context?.now || new Date(), 10);
  const playlistTerms = [
    playlist.title,
    ...splitTermFragment(playlist.description || ''),
  ].filter(Boolean);
  const moodTerms = playlist.mood ? (MOOD_KEYWORDS[playlist.mood] || []) : [];

  const artistSlice = rotate(artists, plIndex * 2, 3);
  const genreSlice = rotate(genres, plIndex * 2, 4);
  const interestSlice = rotate(interests, plIndex * 3, 6);
  const recentSlice = rotate(recentTerms, plIndex * 2, 4);
  const scheduleSlice = rotate(scheduleTerms, plIndex * 2, 4);

  for (const term of playlistTerms.slice(0, 3)) add(term, 'playlist', 9, plIndex);
  for (const term of moodTerms.slice(0, 2)) add(term, 'mood', 7, plIndex + 1);

  for (const artist of artistSlice) {
    const genre = genreSlice[requests.length % Math.max(1, genreSlice.length)];
    const interest = interestSlice[requests.length % Math.max(1, interestSlice.length)];
    const recent = recentSlice[requests.length % Math.max(1, recentSlice.length)];
    const schedule = scheduleSlice[requests.length % Math.max(1, scheduleSlice.length)];
    if (recent) add(`${artist} ${recent}`, 'recent', 10, plIndex + 1);
    if (schedule) add(`${artist} ${schedule}`, 'schedule', 9, plIndex + 2);
    if (genre) add(`${artist} ${genre}`, 'artist', 10, plIndex);
    if (interest) add(`${artist} ${interest}`, 'artist', 9, plIndex + 1);
    add(artist, 'artist', 7, plIndex + 2);
  }

  for (const interest of interestSlice) {
    const genre = genreSlice[requests.length % Math.max(1, genreSlice.length)];
    const recent = recentSlice[requests.length % Math.max(1, recentSlice.length)];
    const schedule = scheduleSlice[requests.length % Math.max(1, scheduleSlice.length)];
    if (genre) add(`${interest} ${genre}`, 'interest', 8, plIndex + requests.length);
    if (recent) add(`${interest} ${recent}`, 'recent', 8, plIndex + requests.length + 1);
    if (schedule) add(`${interest} ${schedule}`, 'schedule', 8, plIndex + requests.length + 2);
    add(interest, 'interest', 6, plIndex + requests.length + 1);
  }

  for (const recent of recentSlice) {
    const genre = genreSlice[requests.length % Math.max(1, genreSlice.length)];
    if (genre) add(`${recent} ${genre}`, 'recent', 8, plIndex + requests.length);
    add(recent, 'recent', 8, plIndex + requests.length + 1);
  }

  for (const schedule of scheduleSlice) {
    const genre = genreSlice[requests.length % Math.max(1, genreSlice.length)];
    if (genre) add(`${schedule} ${genre}`, 'schedule', 7, plIndex + requests.length);
    add(schedule, 'schedule', 7, plIndex + requests.length + 1);
  }

  for (const genre of genreSlice) add(genre, 'genre', 6, plIndex + requests.length);

  if (requests.length === 0) {
    for (const artist of artists.slice(0, 4)) add(artist, 'artist', 5, plIndex);
    for (const genre of genres.slice(0, 4)) add(genre, 'genre', 5, plIndex);
  }

  return requests.slice(0, 18);
}

const hash01 = (value: string): number => {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
};

const includesLoose = (haystack: string, needle: string): boolean => {
  const a = normalizeKey(haystack).replace(/[^\p{L}\p{N}]+/gu, '');
  const b = normalizeKey(needle).replace(/[^\p{L}\p{N}]+/gu, '');
  return !!b && a.includes(b);
};

const primaryArtistKey = (artists: string): string => normalizeKey((artists || '').split(/[\/,，、]/)[0] || artists || 'unknown');

export function pickDiversePlaylistSongs(args: {
  char: CharacterProfile;
  profile: CharMusicProfile;
  playlist: CharPlaylist;
  candidates: PlaylistSongCandidate[];
  usedSongIds?: Set<number>;
  count?: number;
}): CharPlaylistSong[] {
  const { char, profile, playlist, candidates } = args;
  const count = args.count ?? 8;
  const usedSongIds = args.usedSongIds || new Set<number>();
  const artists = profile.signatureArtists.map(a => a.name).filter(Boolean);
  const genres = profile.genreTags.filter(Boolean);
  const interests = collectCharacterMusicInterestTerms(char, 14);
  const playlistTerms = [
    playlist.title,
    playlist.description,
    ...(playlist.mood ? (MOOD_KEYWORDS[playlist.mood] || []) : []),
  ].filter(Boolean);

  const byId = new Map<number, { song: CharPlaylistSong; score: number }>();
  for (const candidate of candidates) {
    const { song, request, rank } = candidate;
    if (!song?.id || usedSongIds.has(song.id)) continue;
    const blob = `${song.name} ${song.artists} ${song.album}`;
    let score = request.weight * 10 - rank * 1.2;
    if (artists.some(a => includesLoose(song.artists, a))) score += 26;
    if (genres.some(g => includesLoose(blob, g) || includesLoose(request.keyword, g))) score += 12;
    if (interests.some(t => includesLoose(blob, t) || includesLoose(request.keyword, t))) score += 14;
    if (playlistTerms.some(t => includesLoose(blob, String(t)) || includesLoose(request.keyword, String(t)))) score += 8;
    if (request.source === 'artist' && artists.some(a => includesLoose(request.keyword, a))) score += 6;
    score += hash01(`${char.id}:${playlist.id}:${song.id}`) * 2;

    const prev = byId.get(song.id);
    if (!prev || score > prev.score) byId.set(song.id, { song, score });
  }

  const ranked = [...byId.values()].sort((a, b) => b.score - a.score);
  const picked: CharPlaylistSong[] = [];
  const pickedKeys = new Set<string>();
  const artistCounts = new Map<string, number>();

  const tryPick = (limitPerArtist: number) => {
    for (const item of ranked) {
      if (picked.length >= count) break;
      const key = `${normalizeKey(item.song.name)}::${normalizeKey(item.song.artists)}`;
      if (pickedKeys.has(key)) continue;
      const artistKey = primaryArtistKey(item.song.artists);
      if ((artistCounts.get(artistKey) || 0) >= limitPerArtist) continue;
      pickedKeys.add(key);
      artistCounts.set(artistKey, (artistCounts.get(artistKey) || 0) + 1);
      picked.push({ ...item.song, source: item.song.source || 'discovered', addedAt: item.song.addedAt || Date.now() });
    }
  };

  tryPick(2);
  if (picked.length < count) tryPick(4);

  return picked.slice(0, count);
}
