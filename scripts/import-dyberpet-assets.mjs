import { mkdir, readdir, readFile, rm, stat, copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_SOURCE = 'D:/Applications/DyberPet_GenshinImpact-main';
const SOURCE_ROOT = process.argv[2] || DEFAULT_SOURCE;
const OUT_ROOT = path.resolve(process.cwd(), 'public/dyberpet/genshin');
const ROLE_NAMES = ['流浪者', '纳西妲'];
const ITEM_PACK = 'Genshin';

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));

const copyDir = async (src, dest) => {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(from, to);
    } else if (entry.isFile()) {
      await copyFile(from, to);
    }
  }
};

const sortFrameFiles = (files) => [...files].sort((a, b) => {
  const an = Number((a.match(/_(\d+)\.[^.]+$/) || [])[1] ?? Number.MAX_SAFE_INTEGER);
  const bn = Number((b.match(/_(\d+)\.[^.]+$/) || [])[1] ?? Number.MAX_SAFE_INTEGER);
  if (an !== bn) return an - bn;
  return a.localeCompare(b, 'zh-Hans-CN');
});

const publicPath = (...segments) => `./${segments.map(segment => encodeURIComponent(segment)).join('/')}`;

const actionFrames = async (actionDir, imagePrefix, roleName) => {
  const files = await readdir(actionDir);
  return sortFrameFiles(files.filter(file => file.startsWith(`${imagePrefix}_`) && /\.png$/i.test(file)))
    .map(file => publicPath('dyberpet', 'genshin', 'role', roleName, 'action', file));
};

const normalizeRandomAct = (act) => ({
  name: String(act?.name || ''),
  actList: Array.isArray(act?.act_list) ? act.act_list.map(String) : [],
  actProb: Number(act?.act_prob || 0),
  actType: Array.isArray(act?.act_type) ? act.act_type.slice(0, 2).map(Number) : [0, 0],
  sound: Array.isArray(act?.sound) ? act.sound.map(String) : undefined,
});

async function main() {
  const sourceStat = await stat(SOURCE_ROOT).catch(() => null);
  if (!sourceStat?.isDirectory()) {
    throw new Error(`DyberPet source not found: ${SOURCE_ROOT}`);
  }

  await rm(OUT_ROOT, { recursive: true, force: true });
  await mkdir(OUT_ROOT, { recursive: true });

  const roleOutRoot = path.join(OUT_ROOT, 'role');
  const itemOutRoot = path.join(OUT_ROOT, 'items', ITEM_PACK);
  const roles = {};

  for (const roleName of ROLE_NAMES) {
    const srcRole = path.join(SOURCE_ROOT, 'res', 'role', roleName);
    const destRole = path.join(roleOutRoot, roleName);
    await copyDir(srcRole, destRole);

    const petConf = await readJson(path.join(srcRole, 'pet_conf.json'));
    const actConf = await readJson(path.join(srcRole, 'act_conf.json'));
    const actionDir = path.join(srcRole, 'action');
    const actions = {};

    for (const [actionId, action] of Object.entries(actConf)) {
      const images = String(action?.images || actionId);
      actions[actionId] = {
        id: actionId,
        images,
        actNum: Number(action?.act_num || 1),
        frameRefresh: Number(action?.frame_refresh || 0.08),
        needMove: action?.need_move === true,
        direction: action?.direction,
        frameMove: Number(action?.frame_move || 0),
        anchor: Array.isArray(action?.anchor) ? action.anchor.slice(0, 2).map(Number) : undefined,
        frames: await actionFrames(actionDir, images, roleName),
      };
    }

    roles[roleName] = {
      id: roleName,
      name: roleName,
      width: Number(petConf.width || 300),
      height: Number(petConf.height || 320),
      scale: Number(petConf.scale || 1),
      refresh: Number(petConf.refresh || 5),
      interactSpeed: Number(petConf.interact_speed || 0.02),
      defaultAction: String(petConf.default || 'default'),
      patAction: String(petConf.patpat || 'patpat'),
      randomActs: Array.isArray(petConf.random_act) ? petConf.random_act.map(normalizeRandomAct) : [],
      favorites: petConf.item_favorite || {},
      dislikes: petConf.item_dislike || {},
      messageDict: petConf.msg_dict || {},
      actions,
    };
  }

  const srcItems = path.join(SOURCE_ROOT, 'res', 'items', ITEM_PACK);
  await copyDir(srcItems, itemOutRoot);
  const itemConf = await readJson(path.join(srcItems, 'items_config.json'));
  const items = {};
  for (const [id, item] of Object.entries(itemConf)) {
    items[id] = {
      id,
      name: String(item?.name || id),
      effectHP: Number(item?.effect_HP || 0),
      effectFV: Number(item?.effect_FV || 0),
      dropRate: Number(item?.drop_rate || 0),
      fvLock: Number(item?.fv_lock || 0),
      fvReward: Number(item?.fv_reward || 0),
      type: String(item?.type || 'consumable'),
      description: String(item?.description || ''),
      image: item?.image ? publicPath('dyberpet', 'genshin', 'items', ITEM_PACK, String(item.image)) : '',
      petLimit: Array.isArray(item?.pet_limit) ? item.pet_limit.map(String) : undefined,
    };
  }

  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: SOURCE_ROOT,
    roles,
    items,
  };

  await writeFile(path.join(OUT_ROOT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await writeFile(
    path.join(OUT_ROOT, 'NOTICE.txt'),
    [
      'DyberPet Genshin assets copied for local Moro desktop pet integration.',
      `Source: ${SOURCE_ROOT}`,
      'Copied: res/role/流浪者, res/role/纳西妲, res/items/Genshin',
      'Not copied: executables, packaged Python runtime, user data, chat logs, pet_data.json.',
      'Keep original upstream and game asset licensing in mind before redistributing.',
      '',
    ].join('\n'),
    'utf8',
  );

  console.log(`Imported ${Object.keys(roles).length} roles and ${Object.keys(items).length} items into ${OUT_ROOT}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
