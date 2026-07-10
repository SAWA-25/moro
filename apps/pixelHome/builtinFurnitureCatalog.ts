import type { MemoryRoom } from '../../utils/memoryPalace/types';
import type { PixelAsset } from './types';

export const BUILTIN_PIXEL_ASSET_PREFIX = 'builtin_pixel_home_';
export const BUILTIN_PIXEL_SIZE = 32;

const SCALE = 4;
const BUILTIN_CREATED_AT = 4102444800000; // 2100-01-01，让内置素材在“按时间”里排在前面。
const FALLBACK_PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

type BuiltinCategory = 'furniture' | 'decor' | 'plant' | 'food' | 'other';
type BuiltinRoomTag = '客厅' | '卧室' | '书房' | '阁楼' | '自我房' | '用户房' | '露台';
type CatalogItem = [slug: string, name: string, shape: string, category: BuiltinCategory, extraTags?: string[]];
type CatalogGroup = {
  room: MemoryRoom;
  roomTag: BuiltinRoomTag;
  items: CatalogItem[];
  groupTags?: string[];
};

export interface BuiltinPixelFurnitureDef {
  id: string;
  name: string;
  room: MemoryRoom;
  roomTag: BuiltinRoomTag;
  shape: string;
  category: BuiltinCategory;
  tags: string[];
}

const ROOM_CATALOGS: CatalogGroup[] = [
  {
    room: 'living_room',
    roomTag: '客厅',
    items: [
      ['living_sofa_moss', '苔绿沙发', 'sofa', 'furniture'],
      ['living_armchair_amber', '焦糖软椅', 'armchair', 'furniture'],
      ['living_coffee_table_walnut', '胡桃茶几', 'coffee_table', 'furniture'],
      ['living_tv_blue', '小屏电视', 'tv', 'furniture'],
      ['living_media_console', '电视矮柜', 'media_console', 'furniture'],
      ['living_bookcase', '客厅书架', 'bookcase', 'furniture'],
      ['living_low_cabinet', '抽屉矮柜', 'cabinet', 'furniture'],
      ['living_floor_lamp', '立式暖灯', 'floor_lamp', 'furniture'],
      ['living_side_table', '沙发边几', 'side_table', 'furniture'],
      ['living_potted_fern', '蕨叶绿植', 'plant', 'plant'],
      ['living_flower_vase', '圆肚花瓶', 'vase', 'decor'],
      ['living_rug_rose', '玫瑰小地毯', 'rug', 'decor', ['rug', '地毯']],
      ['living_rug_teal', '湖蓝条纹地毯', 'rug', 'decor', ['rug', '地毯']],
      ['living_record_player', '唱片机', 'record_player', 'decor'],
      ['living_game_console', '游戏机', 'game_console', 'decor'],
      ['living_magazine_rack', '杂志架', 'magazine_rack', 'decor'],
      ['living_pillow_stack', '抱枕叠叠', 'pillow', 'decor'],
      ['living_snack_tray', '零食托盘', 'snack_tray', 'food'],
    ],
  },
  {
    room: 'bedroom',
    roomTag: '卧室',
    items: [
      ['bedroom_single_bed', '木框单人床', 'single_bed', 'furniture'],
      ['bedroom_double_bed', '软垫双人床', 'double_bed', 'furniture'],
      ['bedroom_duvet_bed', '鼓鼓被窝床', 'duvet_bed', 'furniture'],
      ['bedroom_nightstand', '床头小柜', 'nightstand', 'furniture'],
      ['bedroom_wardrobe', '双门衣柜', 'wardrobe', 'furniture'],
      ['bedroom_vanity', '梳妆台', 'vanity', 'furniture'],
      ['bedroom_mirror', '立式镜子', 'mirror', 'decor'],
      ['bedroom_desk', '卧室书桌', 'desk', 'furniture'],
      ['bedroom_chair', '软垫椅子', 'chair', 'furniture'],
      ['bedroom_table_lamp', '床头台灯', 'table_lamp', 'furniture'],
      ['bedroom_night_light', '小夜灯', 'night_light', 'decor'],
      ['bedroom_heart_pillow', '心形抱枕', 'pillow', 'decor'],
      ['bedroom_plushie', '床边玩偶', 'plushie', 'decor'],
      ['bedroom_laundry_basket', '洗衣篮', 'laundry_basket', 'other'],
      ['bedroom_rug_round', '圆圆床边毯', 'rug', 'decor', ['rug', '地毯']],
      ['bedroom_rug_cloud', '云朵床边毯', 'rug', 'decor', ['rug', '地毯']],
      ['bedroom_photo_frame', '床头相框', 'frame', 'decor'],
      ['bedroom_diffuser', '睡前香薰', 'diffuser', 'decor'],
    ],
  },
  {
    room: 'study',
    roomTag: '书房',
    items: [
      ['study_writing_desk', '写字桌', 'writing_desk', 'furniture'],
      ['study_swivel_chair', '转椅', 'swivel_chair', 'furniture'],
      ['study_computer_desk', '电脑桌', 'computer_desk', 'furniture'],
      ['study_monitor', '显示器', 'monitor', 'furniture'],
      ['study_keyboard', '机械键盘', 'keyboard', 'decor'],
      ['study_bookcase_tall', '高高书架', 'bookcase', 'furniture'],
      ['study_file_cabinet', '文件柜', 'file_cabinet', 'furniture'],
      ['study_book_stack', '书堆', 'books', 'decor'],
      ['study_paper_box', '资料纸箱', 'box', 'other'],
      ['study_table_lamp', '护眼台灯', 'table_lamp', 'furniture'],
      ['study_floor_lamp', '阅读落地灯', 'floor_lamp', 'furniture'],
      ['study_globe', '小地球仪', 'globe', 'decor'],
      ['study_whiteboard', '白板', 'board', 'decor'],
      ['study_easel', '画架', 'easel', 'decor'],
      ['study_tea_cup', '工作茶杯', 'cup', 'food'],
      ['study_potted_plant', '书桌绿植', 'plant', 'plant'],
      ['study_rug_grid', '格纹书房毯', 'rug', 'decor', ['rug', '地毯']],
      ['study_pencil_box', '文具盒', 'pencil_box', 'decor'],
    ],
  },
  {
    room: 'attic',
    roomTag: '阁楼',
    items: [
      ['attic_trunk', '旧木箱', 'trunk', 'other'],
      ['attic_suitcase', '旧行李箱', 'suitcase', 'other'],
      ['attic_old_wardrobe', '旧衣柜', 'wardrobe', 'furniture'],
      ['attic_old_mirror', '斑驳旧镜', 'mirror', 'decor'],
      ['attic_old_books', '旧书堆', 'books', 'decor'],
      ['attic_box_stack', '纸箱堆', 'box_stack', 'other'],
      ['attic_old_lamp', '旧台灯', 'table_lamp', 'furniture'],
      ['attic_pendant_lamp', '阁楼吊灯', 'pendant_lamp', 'furniture'],
      ['attic_rug_faded', '褪色旧地毯', 'rug', 'decor', ['rug', '地毯']],
      ['attic_quilt_rug', '拼布毯', 'quilt_rug', 'decor', ['rug', '地毯']],
      ['attic_folding_chair', '折叠椅', 'folding_chair', 'furniture'],
      ['attic_small_table', '旧小桌', 'table', 'furniture'],
      ['attic_record_player', '老留声机', 'record_player', 'decor'],
      ['attic_photo_box', '相册箱', 'photo_box', 'decor'],
      ['attic_toy_box', '玩具箱', 'toy_box', 'decor'],
      ['attic_ladder', '木梯子', 'ladder', 'other'],
      ['attic_dry_vase', '干花瓶', 'dry_vase', 'decor'],
      ['attic_curtain', '旧布帘', 'curtain', 'decor'],
    ],
  },
  {
    room: 'self_room',
    roomTag: '自我房',
    items: [
      ['self_diary_desk', '日记桌', 'diary_desk', 'furniture'],
      ['self_display_case', '展示柜', 'display_case', 'furniture'],
      ['self_trophy_shelf', '奖杯架', 'trophy_shelf', 'furniture'],
      ['self_poster_frame', '海报架', 'poster_frame', 'decor'],
      ['self_vanity', '自我梳妆台', 'vanity', 'furniture'],
      ['self_hanger', '衣帽架', 'hanger', 'furniture'],
      ['self_collection_shelf', '收藏柜', 'collection_shelf', 'furniture'],
      ['self_craft_table', '手作台', 'craft_table', 'furniture'],
      ['self_diffuser_table', '香薰台', 'diffuser', 'decor'],
      ['self_floor_cushion', '软软坐垫', 'cushion', 'decor'],
      ['self_loveseat', '小沙发', 'loveseat', 'furniture'],
      ['self_pillows', '抱枕堆', 'pillow', 'decor'],
      ['self_jewelry_box', '首饰盒', 'jewelry_box', 'decor'],
      ['self_photo_wall', '照片墙', 'photo_wall', 'decor'],
      ['self_rug_star', '星星地毯', 'rug', 'decor', ['rug', '地毯']],
      ['self_rug_diary', '日记格地毯', 'rug', 'decor', ['rug', '地毯']],
      ['self_memo_board', '留言板', 'memo_board', 'decor'],
      ['self_storage_cart', '收纳推车', 'cart', 'furniture'],
    ],
  },
  {
    room: 'user_room',
    roomTag: '用户房',
    items: [
      ['user_guest_bed', '客人床', 'guest_bed', 'furniture'],
      ['user_folding_bed', '折叠床', 'folding_bed', 'furniture'],
      ['user_writing_desk', '用户写字台', 'writing_desk', 'furniture'],
      ['user_luggage_rack', '行李架', 'luggage_rack', 'furniture'],
      ['user_gift_box', '礼物盒', 'gift', 'decor'],
      ['user_letter_table', '信件桌', 'letter_table', 'furniture'],
      ['user_photo_wall', '相框墙', 'photo_wall', 'decor'],
      ['user_hanger', '衣帽架', 'hanger', 'furniture'],
      ['user_storage_cabinet', '置物柜', 'cabinet', 'furniture'],
      ['user_bed_lamp', '床头灯', 'bed_lamp', 'furniture'],
      ['user_table_lamp', '用户台灯', 'table_lamp', 'furniture'],
      ['user_floor_cushion', '客房坐垫', 'cushion', 'decor'],
      ['user_tea_table', '小茶几', 'tea_table', 'furniture'],
      ['user_potted_plant', '欢迎绿植', 'plant', 'plant'],
      ['user_memory_rug', '纪念毯', 'memory_rug', 'decor', ['rug', '地毯']],
      ['user_welcome_mat', '欢迎地垫', 'welcome_mat', 'decor', ['rug', '地毯']],
      ['user_storage_box', '储物箱', 'storage_box', 'other'],
      ['user_postcard_rack', '明信片架', 'postcard_rack', 'decor'],
    ],
  },
  {
    room: 'windowsill',
    roomTag: '露台',
    items: [
      ['terrace_bench', '露台长椅', 'bench', 'furniture'],
      ['terrace_round_table', '小圆桌', 'round_table', 'furniture'],
      ['terrace_outdoor_chair', '户外椅', 'outdoor_chair', 'furniture'],
      ['terrace_flower_stand', '花架', 'flower_stand', 'plant'],
      ['terrace_flower_pots', '花盆组', 'flower_pots', 'plant'],
      ['terrace_trellis', '藤架', 'trellis', 'plant'],
      ['terrace_watering_can', '浇水壶', 'watering_can', 'other'],
      ['terrace_lantern', '小灯笼', 'lantern', 'decor'],
      ['terrace_wind_chime', '风铃', 'wind_chime', 'decor'],
      ['terrace_telescope', '望远镜', 'telescope', 'decor'],
      ['terrace_drying_rack', '晾晒架', 'drying_rack', 'other'],
      ['terrace_potted_tree', '盆栽树', 'potted_tree', 'plant'],
      ['terrace_flower_box', '栏杆花箱', 'flower_box', 'plant'],
      ['terrace_outdoor_rug', '户外地毯', 'outdoor_rug', 'decor', ['rug', '地毯']],
      ['terrace_stone_mat', '石板垫', 'stone_mat', 'decor', ['rug', '地毯']],
      ['terrace_toolbox', '园艺工具箱', 'toolbox', 'other'],
      ['terrace_candle_lamp', '蜡烛灯', 'candle', 'decor'],
      ['terrace_tea_tray', '露台茶盘', 'tea_tray', 'food'],
    ],
  },
];

const DECOR_SET_CATALOGS: CatalogGroup[] = [
  {
    room: 'living_room',
    roomTag: '客厅',
    groupTags: ['装饰套装', '森系', '木屋'],
    items: [
      ['decor_forest_wreath', '森系门环', 'wreath', 'decor'],
      ['decor_forest_moss_rug', '苔藓小毯', 'rug', 'decor', ['rug', '地毯']],
      ['decor_forest_mushroom_lamp', '蘑菇夜灯', 'mushroom_lamp', 'decor'],
      ['decor_forest_log_sign', '手写木牌', 'sign', 'decor'],
      ['decor_forest_acorn_bowl', '橡果小碗', 'bowl', 'decor'],
      ['decor_forest_leaf_garland', '叶子灯串', 'garland', 'decor'],
      ['decor_forest_terrarium', '苔藓玻璃罩', 'terrarium', 'decor'],
      ['decor_forest_birdhouse', '小鸟屋挂饰', 'birdhouse', 'decor'],
      ['decor_forest_pinecone', '松果摆件', 'pinecone', 'decor'],
      ['decor_forest_branch_mobile', '树枝挂饰', 'mobile', 'decor'],
      ['decor_forest_banner', '木屋挂旗', 'banner', 'decor'],
      ['decor_forest_stump', '树墩摆件', 'stump', 'decor'],
      ['decor_forest_herb_bundle', '香草束', 'herb_bundle', 'decor'],
      ['decor_forest_bark_frame', '树皮相框', 'frame', 'decor'],
      ['decor_forest_firefly_jar', '萤火罐', 'lantern', 'decor'],
      ['decor_forest_rain_boots', '雨靴摆件', 'boots', 'decor'],
      ['decor_forest_mini_pond', '微型水池', 'pond', 'decor'],
      ['decor_forest_leaf_cushion', '叶子靠垫', 'pillow', 'decor'],
    ],
  },
  {
    room: 'study',
    roomTag: '书房',
    groupTags: ['装饰套装', '赛博', '霓虹'],
    items: [
      ['decor_cyber_neon_sign', '霓虹招牌', 'neon_sign', 'decor'],
      ['decor_cyber_holo_poster', '全息海报', 'poster_frame', 'decor'],
      ['decor_cyber_pixel_clock', '像素电子钟', 'clock', 'decor'],
      ['decor_cyber_led_strip', 'LED 灯带', 'garland', 'decor'],
      ['decor_cyber_arcade', '迷你街机', 'game_console', 'decor'],
      ['decor_cyber_drone_model', '悬浮机模型', 'drone', 'decor'],
      ['decor_cyber_circuit_rug', '电路纹地毯', 'rug', 'decor', ['rug', '地毯']],
      ['decor_cyber_synth_speaker', '合成器音箱', 'speaker', 'decor'],
      ['decor_cyber_prism_cube', '棱镜方块', 'crystal', 'decor'],
      ['decor_cyber_data_terminal', '数据终端', 'monitor', 'decor'],
      ['decor_cyber_wire_plant', '电线盆栽', 'plant', 'decor'],
      ['decor_cyber_glow_bottle', '荧光瓶', 'vase', 'decor'],
      ['decor_cyber_chip_frame', '芯片相框', 'frame', 'decor'],
      ['decor_cyber_laser_lamp', '激光小灯', 'table_lamp', 'decor'],
      ['decor_cyber_keyboard_art', '键帽拼画', 'keyboard', 'decor'],
      ['decor_cyber_status_board', '状态灯板', 'board', 'decor'],
      ['decor_cyber_orb_stand', '漂浮光球', 'orb', 'decor'],
      ['decor_cyber_warning_tape', '警戒胶带', 'banner', 'decor'],
    ],
  },
  {
    room: 'attic',
    roomTag: '阁楼',
    groupTags: ['装饰套装', '复古', '剧院'],
    items: [
      ['decor_theater_velvet_curtain', '丝绒幕布', 'curtain', 'decor'],
      ['decor_theater_stage_mask', '剧场面具', 'mask', 'decor'],
      ['decor_theater_ticket_board', '票根板', 'memo_board', 'decor'],
      ['decor_theater_marquee_lamp', '剧院灯牌', 'neon_sign', 'decor'],
      ['decor_theater_gramophone', '金色留声机', 'record_player', 'decor'],
      ['decor_theater_script_stack', '剧本叠叠', 'books', 'decor'],
      ['decor_theater_spotlight', '小聚光灯', 'floor_lamp', 'decor'],
      ['decor_theater_red_carpet', '红毯', 'rug', 'decor', ['rug', '地毯']],
      ['decor_theater_rose_bouquet', '谢幕玫瑰', 'vase', 'decor'],
      ['decor_theater_poster', '老电影海报', 'poster_frame', 'decor'],
      ['decor_theater_top_hat', '礼帽摆件', 'hat', 'decor'],
      ['decor_theater_violin_case', '琴盒', 'suitcase', 'decor'],
      ['decor_theater_makeup_mirror', '化妆灯镜', 'mirror', 'decor'],
      ['decor_theater_clapperboard', '场记板', 'board', 'decor'],
      ['decor_theater_pearl_lamp', '珍珠台灯', 'table_lamp', 'decor'],
      ['decor_theater_lace_fan', '蕾丝折扇', 'fan', 'decor'],
      ['decor_theater_props_box', '道具箱', 'toy_box', 'decor'],
      ['decor_theater_star_banner', '星星挂旗', 'banner', 'decor'],
    ],
  },
  {
    room: 'windowsill',
    roomTag: '露台',
    groupTags: ['装饰套装', '海滨', '假日'],
    items: [
      ['decor_beach_shell_mobile', '贝壳风铃', 'mobile', 'decor'],
      ['decor_beach_coral_bowl', '珊瑚小碗', 'bowl', 'decor'],
      ['decor_beach_surfboard', '冲浪板', 'board', 'decor'],
      ['decor_beach_mat', '沙滩垫', 'rug', 'decor', ['rug', '地毯']],
      ['decor_beach_lighthouse_lamp', '灯塔小灯', 'lighthouse_lamp', 'decor'],
      ['decor_beach_ship_bottle', '瓶中船', 'ship_bottle', 'decor'],
      ['decor_beach_starfish_frame', '海星相框', 'frame', 'decor'],
      ['decor_beach_parasol', '迷你阳伞', 'parasol', 'decor'],
      ['decor_beach_ball', '沙滩球', 'ball', 'decor'],
      ['decor_beach_coconut_cup', '椰子杯', 'cup', 'decor'],
      ['decor_beach_sandcastle', '小沙堡', 'castle', 'decor'],
      ['decor_beach_driftwood_sign', '漂流木牌', 'sign', 'decor'],
      ['decor_beach_wave_banner', '海浪挂旗', 'banner', 'decor'],
      ['decor_beach_fish_kite', '小鱼风筝', 'kite', 'decor'],
      ['decor_beach_seaglass_jar', '海玻璃罐', 'vase', 'decor'],
      ['decor_beach_towel_roll', '卷卷浴巾', 'pillow', 'decor'],
      ['decor_beach_shell_wreath', '贝壳花环', 'wreath', 'decor'],
      ['decor_beach_mini_boat', '迷你小船', 'boat', 'decor'],
    ],
  },
  {
    room: 'self_room',
    roomTag: '自我房',
    groupTags: ['装饰套装', '月相', '魔法'],
    items: [
      ['decor_magic_moon_lamp', '月亮灯', 'moon_lamp', 'decor'],
      ['decor_magic_crystal_cluster', '水晶簇', 'crystal', 'decor'],
      ['decor_magic_tarot_cloth', '塔罗仪式毯', 'rug', 'decor', ['rug', '地毯']],
      ['decor_magic_spell_scroll', '咒语卷轴', 'scroll', 'decor'],
      ['decor_magic_potion_bottle', '药水瓶', 'vase', 'decor'],
      ['decor_magic_star_garland', '星星灯串', 'garland', 'decor'],
      ['decor_magic_circle_rug', '魔法阵地毯', 'rug', 'decor', ['rug', '地毯']],
      ['decor_magic_cat_statue', '黑猫雕像', 'statue', 'decor'],
      ['decor_magic_incense_holder', '线香座', 'candle', 'decor'],
      ['decor_magic_constellation_map', '星图', 'poster_frame', 'decor'],
      ['decor_magic_candle_trio', '三支蜡烛', 'candle', 'decor'],
      ['decor_magic_rune_stones', '符文石', 'rune_stones', 'decor'],
      ['decor_magic_witch_hat', '尖尖帽', 'hat', 'decor'],
      ['decor_magic_crescent_mirror', '弯月镜', 'mirror', 'decor'],
      ['decor_magic_herb_bundle', '魔草束', 'herb_bundle', 'decor'],
      ['decor_magic_orb_stand', '占卜光球', 'orb', 'decor'],
      ['decor_magic_charm_mobile', '护符挂饰', 'mobile', 'decor'],
      ['decor_magic_velvet_pouch', '丝绒小袋', 'pouch', 'decor'],
    ],
  },
  {
    room: 'bedroom',
    roomTag: '卧室',
    groupTags: ['装饰套装', '糖果', '波普'],
    items: [
      ['decor_candy_rug', '糖纸地毯', 'rug', 'decor', ['rug', '地毯']],
      ['decor_candy_lollipop_lamp', '棒棒糖灯', 'lollipop_lamp', 'decor'],
      ['decor_candy_gumball_machine', '糖果机', 'gumball', 'decor'],
      ['decor_candy_cupcake_stand', '纸杯蛋糕架', 'cupcake', 'decor'],
      ['decor_candy_rainbow_poster', '彩虹海报', 'poster_frame', 'decor'],
      ['decor_candy_heart_neon', '爱心霓虹', 'neon_sign', 'decor'],
      ['decor_candy_pastel_cloud', '粉彩云朵', 'cloud', 'decor'],
      ['decor_candy_toy_blocks', '积木摆件', 'toy_box', 'decor'],
      ['decor_candy_balloon_bunch', '气球束', 'balloon', 'decor'],
      ['decor_candy_star_pillow', '星星靠垫', 'pillow', 'decor'],
      ['decor_candy_donut_cushion', '甜甜圈坐垫', 'pillow', 'decor'],
      ['decor_candy_jar', '糖果罐', 'vase', 'decor'],
      ['decor_candy_soda_float', '汽水杯', 'cup', 'decor'],
      ['decor_candy_sticker_board', '贴纸板', 'memo_board', 'decor'],
      ['decor_candy_bow_mirror', '蝴蝶结镜', 'mirror', 'decor'],
      ['decor_candy_confetti_banner', '彩纸挂旗', 'banner', 'decor'],
      ['decor_candy_plush_crown', '毛绒皇冠', 'plushie', 'decor'],
      ['decor_candy_pop_mat', '圆点地垫', 'rug', 'decor', ['rug', '地毯']],
    ],
  },
  {
    room: 'user_room',
    roomTag: '用户房',
    groupTags: ['装饰套装', '茶室', '画廊'],
    items: [
      ['decor_gallery_tea_scroll', '茶席挂轴', 'scroll', 'decor'],
      ['decor_gallery_porcelain_vase', '青瓷花瓶', 'vase', 'decor'],
      ['decor_gallery_ink_painting', '水墨小画', 'poster_frame', 'decor'],
      ['decor_gallery_bamboo_blind', '竹帘', 'curtain', 'decor'],
      ['decor_gallery_tatami_mat', '榻榻米地垫', 'rug', 'decor', ['rug', '地毯']],
      ['decor_gallery_tea_tray', '茶具托盘', 'tea_tray', 'decor'],
      ['decor_gallery_bonsai', '小盆景', 'plant', 'decor'],
      ['decor_gallery_paper_lantern', '纸灯笼', 'lantern', 'decor'],
      ['decor_gallery_calligraphy_board', '书法牌', 'board', 'decor'],
      ['decor_gallery_fan_wall', '折扇墙饰', 'fan', 'decor'],
      ['decor_gallery_ceramic_cat', '陶瓷招财猫', 'statue', 'decor'],
      ['decor_gallery_incense_burner', '香炉', 'candle', 'decor'],
      ['decor_gallery_flower_arrangement', '一枝花道', 'vase', 'decor'],
      ['decor_gallery_screen_panel', '小屏风', 'curtain', 'decor'],
      ['decor_gallery_scroll_rack', '卷轴架', 'magazine_rack', 'decor'],
      ['decor_gallery_moon_window', '月窗相框', 'frame', 'decor'],
      ['decor_gallery_tea_cabinet', '茶罐陈列', 'display_case', 'decor'],
      ['decor_gallery_rice_lamp', '和纸小灯', 'table_lamp', 'decor'],
    ],
  },
];

export const BUILTIN_PIXEL_FURNITURE_DEFS: BuiltinPixelFurnitureDef[] = [...ROOM_CATALOGS, ...DECOR_SET_CATALOGS].flatMap(({ room, roomTag, items, groupTags = [] }) =>
  items.map(([slug, name, shape, category, extraTags = []]) => ({
    id: `${BUILTIN_PIXEL_ASSET_PREFIX}${slug}`,
    name,
    room,
    roomTag,
    shape,
    category,
    tags: Array.from(new Set(['builtin', '内置', category, roomTag, ...groupTags, ...extraTags])),
  })),
);

const builtinIds = new Set(BUILTIN_PIXEL_FURNITURE_DEFS.map(item => item.id));
const imageCache = new Map<string, string>();

export function isBuiltinPixelAssetId(id: string | null | undefined): boolean {
  return !!id && id.startsWith(BUILTIN_PIXEL_ASSET_PREFIX);
}

export function hasBuiltinPixelAsset(id: string | null | undefined): boolean {
  return !!id && builtinIds.has(id);
}

export function getBuiltinPixelAssets(): PixelAsset[] {
  return BUILTIN_PIXEL_FURNITURE_DEFS.map((def, index) => {
    const pixelImage = builtinPixelSrc(def);
    return {
      id: def.id,
      name: def.name,
      originalImage: pixelImage,
      pixelImage,
      pixelSize: BUILTIN_PIXEL_SIZE,
      palette: paletteFor(def).swatches,
      width: BUILTIN_PIXEL_SIZE,
      height: BUILTIN_PIXEL_SIZE,
      createdAt: BUILTIN_CREATED_AT - index,
      tags: def.tags,
      isBuiltin: true,
    };
  });
}

export function mergePixelAssets(userAssets: PixelAsset[]): PixelAsset[] {
  const builtinAssets = getBuiltinPixelAssets();
  const builtinAssetIds = new Set(builtinAssets.map(asset => asset.id));
  const editableUserAssets = userAssets
    .filter(asset => !builtinAssetIds.has(asset.id))
    .map(asset => ({ ...asset, isBuiltin: false }));
  return [...builtinAssets, ...editableUserAssets];
}

function builtinPixelSrc(def: BuiltinPixelFurnitureDef): string {
  const cached = imageCache.get(def.id);
  if (cached) return cached;
  if (typeof document === 'undefined') return FALLBACK_PIXEL;

  const small = document.createElement('canvas');
  small.width = BUILTIN_PIXEL_SIZE;
  small.height = BUILTIN_PIXEL_SIZE;
  const s = small.getContext('2d');
  if (!s) return FALLBACK_PIXEL;
  s.imageSmoothingEnabled = false;
  drawBuiltinFurniture(s, def);

  const canvas = document.createElement('canvas');
  canvas.width = BUILTIN_PIXEL_SIZE * SCALE;
  canvas.height = BUILTIN_PIXEL_SIZE * SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return FALLBACK_PIXEL;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, canvas.width, canvas.height);
  const uri = canvas.toDataURL('image/png');
  imageCache.set(def.id, uri);
  return uri;
}

const BASE = {
  ink: '#2a211c',
  softInk: '#4a3a30',
  shadow: 'rgba(35, 25, 18, 0.25)',
  glow: 'rgba(255, 244, 207, 0.5)',
  paper: '#f1dfba',
  white: '#fff7df',
  black: '#171512',
};

const PALETTES = [
  { dark: '#4d3323', mid: '#8a5b38', light: '#d2a36c', accent: '#b96a5e', leaf: '#5f8b54' },
  { dark: '#3c4f57', mid: '#6d8d91', light: '#b8d0c3', accent: '#d49a72', leaf: '#6b945c' },
  { dark: '#4b435c', mid: '#756f94', light: '#c4b9d5', accent: '#d98d92', leaf: '#719c68' },
  { dark: '#5b3a44', mid: '#9d6570', light: '#e1a9a4', accent: '#e0b760', leaf: '#597c49' },
  { dark: '#3f4f35', mid: '#718b56', light: '#c8d18c', accent: '#9f6b47', leaf: '#4e7c45' },
  { dark: '#4c4a45', mid: '#817b70', light: '#d6ccb8', accent: '#7ba3b2', leaf: '#668b55' },
];

type DrawPalette = (typeof PALETTES)[number] & { swatches: string[] };

function paletteFor(def: BuiltinPixelFurnitureDef): DrawPalette {
  const p = PALETTES[(hash(def.id) >>> 0) % PALETTES.length];
  return { ...p, swatches: [BASE.ink, p.dark, p.mid, p.light, p.accent, p.leaf] };
}

function hash(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = ((h << 5) - h + value.charCodeAt(i)) | 0;
  return h;
}

function r(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

function p(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
  r(ctx, x, y, 1, 1, color);
}

function box(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string, outline = BASE.ink) {
  r(ctx, x, y, w, h, outline);
  r(ctx, x + 1, y + 1, w - 2, h - 2, fill);
}

function shadow(ctx: CanvasRenderingContext2D, x: number, y: number, w: number) {
  r(ctx, x, y, w, 2, BASE.shadow);
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string) {
  const dx = Math.sign(x2 - x1);
  const dy = Math.sign(y2 - y1);
  let x = x1;
  let y = y1;
  p(ctx, x, y, color);
  while (x !== x2 || y !== y2) {
    if (x !== x2) x += dx;
    if (y !== y2) y += dy;
    p(ctx, x, y, color);
  }
}

function stitches(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, color: string) {
  for (let i = 0; i < w; i += 3) p(ctx, x + i, y, color);
}

function drawBuiltinFurniture(ctx: CanvasRenderingContext2D, def: BuiltinPixelFurnitureDef) {
  ctx.clearRect(0, 0, BUILTIN_PIXEL_SIZE, BUILTIN_PIXEL_SIZE);
  const pal = paletteFor(def);
  const shape = def.shape;

  if (shape.includes('rug') || shape.includes('mat')) drawRug(ctx, pal, shape);
  else if (shape.includes('bed')) drawBed(ctx, pal, shape);
  else if (shape === 'sofa' || shape === 'loveseat' || shape === 'armchair' || shape.includes('chair') || shape === 'bench') drawSeat(ctx, pal, shape);
  else if (shape === 'tv' || shape === 'monitor') drawScreen(ctx, pal, shape);
  else if (shape === 'computer_desk') drawComputerDesk(ctx, pal);
  else if (shape.includes('lamp') || shape === 'lantern' || shape === 'candle' || shape === 'night_light') drawLamp(ctx, pal, shape);
  else if (shape.includes('plant') || shape.includes('flower') || shape === 'trellis' || shape === 'potted_tree') drawPlant(ctx, pal, shape);
  else if (shape.includes('vase') || shape === 'diffuser') drawVessel(ctx, pal, shape);
  else if (shape.includes('desk') || shape.includes('table')) drawTable(ctx, pal, shape);
  else if (shape.includes('shelf') || shape.includes('case') || shape.includes('cabinet') || shape.includes('wardrobe') || shape.includes('rack')) drawShelf(ctx, pal, shape);
  else if (shape.includes('mirror') || shape.includes('frame') || shape.includes('wall') || shape.includes('poster') || shape === 'board' || shape === 'memo_board') drawWallDecor(ctx, pal, shape);
  else if (shape.includes('box') || shape === 'trunk' || shape === 'suitcase' || shape === 'gift' || shape === 'laundry_basket' || shape.includes('storage')) drawContainer(ctx, pal, shape);
  else drawSmallObject(ctx, pal, shape);

  drawIdentityPixels(ctx, def, pal);
}

function drawRug(ctx: CanvasRenderingContext2D, pal: DrawPalette, shape: string) {
  shadow(ctx, 4, 26, 24);
  box(ctx, 4, 18, 24, 8, pal.mid);
  r(ctx, 6, 20, 20, 4, shape.includes('stone') ? pal.light : pal.accent);
  if (shape.includes('stone')) {
    for (let x = 7; x < 25; x += 5) box(ctx, x, 20, 4, 3, pal.light, pal.dark);
  } else {
    stitches(ctx, 6, 17, 20, pal.light);
    stitches(ctx, 6, 26, 20, pal.light);
    r(ctx, 10, 21, 12, 2, pal.light);
  }
}

function drawBed(ctx: CanvasRenderingContext2D, pal: DrawPalette, shape: string) {
  shadow(ctx, 5, 28, 22);
  box(ctx, 5, 13, 22, 13, pal.dark);
  r(ctx, 7, 15, 18, 9, pal.light);
  r(ctx, 7, 15, 8, 5, BASE.white);
  r(ctx, 15, 16, 10, 8, shape.includes('duvet') ? pal.accent : pal.mid);
  r(ctx, 6, 25, 20, 2, pal.dark);
  r(ctx, 8, 27, 3, 2, BASE.ink);
  r(ctx, 21, 27, 3, 2, BASE.ink);
}

function drawSeat(ctx: CanvasRenderingContext2D, pal: DrawPalette, shape: string) {
  shadow(ctx, 5, 27, 22);
  const wide = shape === 'sofa' || shape === 'loveseat' || shape === 'bench';
  const x = wide ? 5 : 9;
  const w = wide ? 22 : 14;
  box(ctx, x, 15, w, 10, pal.mid);
  r(ctx, x + 2, 11, w - 4, 6, pal.light);
  r(ctx, x - 2, 17, 4, 8, pal.dark);
  r(ctx, x + w - 2, 17, 4, 8, pal.dark);
  r(ctx, x + 3, 24, 3, 3, BASE.ink);
  r(ctx, x + w - 6, 24, 3, 3, BASE.ink);
  if (shape.includes('folding')) line(ctx, x + 3, 25, x + 10, 30, BASE.ink);
}

function drawTable(ctx: CanvasRenderingContext2D, pal: DrawPalette, shape: string) {
  shadow(ctx, 6, 27, 20);
  r(ctx, 5, 15, 22, 4, BASE.ink);
  r(ctx, 6, 14, 20, 4, pal.light);
  r(ctx, 8, 18, 3, 9, pal.dark);
  r(ctx, 21, 18, 3, 9, pal.dark);
  if (shape.includes('letter')) {
    box(ctx, 12, 10, 8, 5, BASE.paper, pal.dark);
    line(ctx, 13, 11, 16, 13, pal.accent);
  } else if (shape.includes('tea')) {
    r(ctx, 14, 10, 5, 4, pal.accent);
    p(ctx, 19, 12, BASE.ink);
  } else {
    r(ctx, 13, 11, 6, 3, BASE.paper);
    p(ctx, 15, 12, pal.accent);
  }
}

function drawScreen(ctx: CanvasRenderingContext2D, pal: DrawPalette, shape: string) {
  shadow(ctx, 7, 28, 18);
  box(ctx, 5, 6, 22, 15, BASE.black);
  r(ctx, 7, 8, 18, 11, pal.dark);
  r(ctx, 8, 9, 8, 3, pal.light);
  r(ctx, 16, 14, 7, 3, pal.mid);
  r(ctx, 15, 21, 2, 5, BASE.softInk);
  r(ctx, 10, 26, 12, 2, BASE.ink);
  if (shape === 'tv') p(ctx, 24, 7, pal.accent);
}

function drawComputerDesk(ctx: CanvasRenderingContext2D, pal: DrawPalette) {
  drawTable(ctx, pal, 'desk');
  box(ctx, 10, 5, 12, 9, BASE.black);
  r(ctx, 12, 7, 8, 5, pal.mid);
  r(ctx, 11, 18, 10, 2, BASE.ink);
}

function drawShelf(ctx: CanvasRenderingContext2D, pal: DrawPalette, shape: string) {
  shadow(ctx, 7, 28, 18);
  box(ctx, 7, 7, 18, 21, pal.dark);
  r(ctx, 9, 10, 14, 2, BASE.ink);
  r(ctx, 9, 17, 14, 2, BASE.ink);
  r(ctx, 10, 9, 3, 7, pal.light);
  r(ctx, 14, 9, 3, 7, pal.accent);
  r(ctx, 18, 9, 4, 7, pal.mid);
  r(ctx, 10, 19, 12, 5, shape.includes('trophy') ? pal.accent : pal.light);
  if (shape.includes('wardrobe')) {
    line(ctx, 16, 8, 16, 26, BASE.ink);
    p(ctx, 14, 17, pal.light);
    p(ctx, 18, 17, pal.light);
  }
}

function drawLamp(ctx: CanvasRenderingContext2D, pal: DrawPalette, shape: string) {
  shadow(ctx, 10, 28, 12);
  if (shape === 'lantern') {
    box(ctx, 11, 10, 10, 13, pal.accent);
    r(ctx, 13, 12, 6, 8, BASE.glow);
    line(ctx, 13, 9, 19, 9, BASE.ink);
    r(ctx, 15, 23, 2, 5, BASE.ink);
    return;
  }
  if (shape === 'candle') {
    r(ctx, 14, 15, 5, 10, BASE.white);
    r(ctx, 13, 25, 8, 2, BASE.ink);
    p(ctx, 16, 13, pal.accent);
    p(ctx, 16, 12, '#ffd978');
    return;
  }
  r(ctx, 15, 14, 2, 13, BASE.ink);
  r(ctx, 10, 26, 12, 2, BASE.ink);
  box(ctx, 10, 8, 12, 7, pal.accent);
  r(ctx, 12, 10, 8, 3, BASE.glow);
  if (shape.includes('floor')) r(ctx, 16, 15, 1, 12, pal.dark);
}

function drawPlant(ctx: CanvasRenderingContext2D, pal: DrawPalette, shape: string) {
  shadow(ctx, 8, 28, 16);
  box(ctx, 11, 21, 10, 7, pal.accent);
  const tall = shape === 'potted_tree' || shape === 'trellis';
  r(ctx, 15, tall ? 8 : 13, 2, 13, pal.leaf);
  for (let i = 0; i < (tall ? 9 : 6); i++) {
    const x = 10 + ((i * 5) % 13);
    const y = (tall ? 7 : 12) + ((i * 3) % 10);
    r(ctx, x, y, 4, 3, i % 2 ? pal.leaf : pal.light);
  }
  if (shape.includes('flower')) {
    p(ctx, 13, 12, pal.accent);
    p(ctx, 19, 10, pal.accent);
  }
}

function drawVessel(ctx: CanvasRenderingContext2D, pal: DrawPalette, shape: string) {
  shadow(ctx, 10, 28, 12);
  box(ctx, 12, 16, 8, 11, pal.mid);
  r(ctx, 14, 13, 4, 4, pal.light);
  if (shape.includes('dry')) {
    line(ctx, 16, 13, 10, 6, pal.dark);
    line(ctx, 16, 13, 22, 6, pal.dark);
  } else {
    p(ctx, 12, 9, pal.accent);
    p(ctx, 17, 8, pal.accent);
    p(ctx, 21, 10, pal.accent);
  }
}

function drawWallDecor(ctx: CanvasRenderingContext2D, pal: DrawPalette, shape: string) {
  shadow(ctx, 8, 28, 16);
  box(ctx, 8, 6, 16, 18, shape.includes('mirror') ? '#b8d7df' : BASE.paper);
  r(ctx, 10, 8, 12, 4, shape.includes('poster') ? pal.accent : pal.light);
  r(ctx, 10, 14, 5, 6, pal.mid);
  r(ctx, 17, 14, 5, 6, pal.dark);
  if (shape.includes('wall')) {
    box(ctx, 5, 8, 7, 7, pal.light);
    box(ctx, 20, 9, 7, 7, pal.accent);
  }
}

function drawContainer(ctx: CanvasRenderingContext2D, pal: DrawPalette, shape: string) {
  shadow(ctx, 7, 28, 18);
  box(ctx, 7, 15, 18, 12, shape === 'gift' ? pal.accent : pal.mid);
  r(ctx, 7, 14, 18, 3, pal.light);
  if (shape === 'gift') {
    r(ctx, 15, 12, 2, 15, BASE.white);
    r(ctx, 8, 19, 16, 2, BASE.white);
  } else {
    r(ctx, 9, 20, 14, 1, pal.dark);
    p(ctx, 16, 18, BASE.ink);
  }
}

function drawSmallObject(ctx: CanvasRenderingContext2D, pal: DrawPalette, shape: string) {
  shadow(ctx, 8, 28, 16);
  if (shape === 'record_player') {
    box(ctx, 7, 16, 18, 10, pal.dark);
    r(ctx, 10, 18, 7, 7, BASE.black);
    p(ctx, 13, 21, BASE.white);
    line(ctx, 19, 18, 23, 15, pal.light);
  } else if (shape === 'game_console' || shape === 'keyboard' || shape === 'pencil_box') {
    box(ctx, 7, 17, 18, 8, pal.mid);
    for (let x = 10; x < 23; x += 3) p(ctx, x, 20, BASE.white);
    p(ctx, 22, 18, pal.accent);
  } else if (shape === 'globe' || shape === 'telescope') {
    box(ctx, 14, 24, 5, 4, pal.dark);
    r(ctx, 16, 15, 2, 9, BASE.ink);
    box(ctx, 10, 8, 12, 9, shape === 'globe' ? pal.light : pal.mid);
    line(ctx, 10, 13, 22, 13, pal.dark);
  } else if (shape === 'easel' || shape === 'ladder' || shape === 'drying_rack') {
    line(ctx, 10, 8, 7, 27, BASE.ink);
    line(ctx, 22, 8, 25, 27, BASE.ink);
    for (let y = 11; y < 24; y += 5) line(ctx, 11, y, 21, y, pal.light);
  } else if (shape === 'watering_can') {
    box(ctx, 8, 17, 13, 9, pal.mid);
    r(ctx, 21, 18, 5, 2, BASE.ink);
    r(ctx, 11, 14, 5, 3, pal.light);
  } else if (shape === 'wind_chime' || shape === 'curtain') {
    line(ctx, 8, 7, 24, 7, BASE.ink);
    for (let x = 10; x < 24; x += 4) {
      line(ctx, x, 8, x, 22, pal.mid);
      p(ctx, x, 24, pal.accent);
    }
  } else if (shape.includes('neon') || shape === 'clock' || shape === 'speaker') {
    box(ctx, 6, 9, 20, 13, BASE.black);
    r(ctx, 8, 11, 16, 2, pal.accent);
    r(ctx, 10, 15, 12, 2, pal.light);
    p(ctx, 9, 19, '#ffef8a');
    p(ctx, 22, 19, '#8ad7ff');
    r(ctx, 12, 22, 8, 5, pal.dark);
  } else if (shape === 'garland' || shape === 'mobile' || shape.includes('banner')) {
    line(ctx, 6, 8, 25, 8, BASE.ink);
    for (let x = 7; x < 26; x += 4) {
      line(ctx, x, 8, x + 1, 18, pal.dark);
      r(ctx, x - 1, 18, 4, 4, x % 8 === 0 ? pal.accent : pal.light);
    }
    if (shape.includes('banner')) {
      r(ctx, 8, 11, 16, 6, pal.mid);
      r(ctx, 10, 13, 4, 4, pal.light);
      r(ctx, 18, 13, 4, 4, pal.accent);
    }
  } else if (shape === 'crystal' || shape === 'orb' || shape === 'statue' || shape === 'rune_stones') {
    if (shape === 'orb') {
      box(ctx, 13, 23, 7, 4, pal.dark);
      r(ctx, 12, 10, 9, 9, BASE.ink);
      r(ctx, 13, 11, 7, 7, pal.light);
      p(ctx, 15, 12, BASE.white);
    } else if (shape === 'statue') {
      box(ctx, 10, 22, 12, 5, pal.dark);
      r(ctx, 12, 11, 8, 12, pal.mid);
      p(ctx, 14, 15, BASE.ink);
      p(ctx, 18, 15, BASE.ink);
    } else {
      r(ctx, 8, 24, 17, 3, BASE.ink);
      line(ctx, 10, 22, 14, 9, pal.light);
      line(ctx, 14, 9, 18, 22, pal.mid);
      line(ctx, 18, 22, 10, 22, pal.accent);
      r(ctx, 20, 19, 4, 4, pal.dark);
      r(ctx, 7, 21, 4, 3, pal.mid);
    }
  } else if (shape.includes('shell') || shape.includes('coral') || shape === 'ship_bottle' || shape === 'boat' || shape === 'parasol' || shape === 'ball' || shape === 'kite') {
    if (shape === 'ship_bottle') {
      box(ctx, 7, 15, 18, 8, '#b8d7df');
      r(ctx, 11, 18, 10, 2, pal.dark);
      line(ctx, 16, 11, 16, 19, BASE.ink);
      line(ctx, 16, 12, 21, 16, BASE.white);
    } else if (shape === 'parasol' || shape === 'kite') {
      line(ctx, 16, 11, 16, 27, BASE.ink);
      r(ctx, 8, 9, 16, 5, pal.accent);
      r(ctx, 11, 14, 10, 3, pal.light);
    } else if (shape === 'ball') {
      box(ctx, 10, 12, 12, 12, pal.light);
      r(ctx, 10, 17, 12, 2, pal.accent);
      r(ctx, 15, 12, 2, 12, pal.mid);
    } else {
      r(ctx, 9, 21, 14, 5, pal.light);
      for (let x = 10; x < 23; x += 3) line(ctx, 16, 14, x, 25, pal.accent);
      p(ctx, 16, 16, BASE.white);
    }
  } else if (shape.includes('moon') || shape.includes('star') || shape === 'cloud' || shape === 'balloon') {
    if (shape === 'balloon') {
      r(ctx, 10, 9, 6, 8, pal.accent);
      r(ctx, 17, 7, 7, 9, pal.light);
      line(ctx, 13, 17, 15, 27, BASE.ink);
      line(ctx, 20, 16, 17, 27, BASE.ink);
    } else if (shape === 'cloud') {
      r(ctx, 8, 16, 17, 6, BASE.white);
      r(ctx, 11, 13, 7, 5, BASE.white);
      r(ctx, 17, 14, 6, 4, pal.light);
    } else {
      r(ctx, 13, 9, 8, 12, pal.light);
      r(ctx, 17, 8, 8, 12, BASE.black);
      p(ctx, 9, 12, pal.accent);
      p(ctx, 23, 18, pal.accent);
      box(ctx, 11, 24, 10, 3, pal.dark);
    }
  } else if (shape === 'scroll' || shape === 'fan' || shape === 'hat' || shape === 'mask') {
    if (shape === 'fan') {
      line(ctx, 16, 24, 8, 12, BASE.ink);
      line(ctx, 16, 24, 24, 12, BASE.ink);
      r(ctx, 9, 12, 14, 7, pal.light);
      r(ctx, 12, 15, 8, 4, pal.accent);
    } else if (shape === 'hat') {
      r(ctx, 8, 22, 17, 3, BASE.ink);
      line(ctx, 13, 21, 17, 8, pal.dark);
      line(ctx, 17, 8, 21, 21, pal.mid);
      r(ctx, 12, 18, 10, 3, pal.accent);
    } else if (shape === 'mask') {
      box(ctx, 9, 11, 14, 10, pal.light);
      p(ctx, 13, 15, BASE.ink);
      p(ctx, 19, 15, BASE.ink);
      r(ctx, 12, 20, 8, 1, pal.accent);
    } else {
      box(ctx, 9, 8, 14, 17, BASE.paper);
      r(ctx, 11, 11, 10, 2, pal.dark);
      r(ctx, 11, 16, 8, 2, pal.accent);
    }
  } else if (shape === 'bowl' || shape === 'cup' || shape === 'cupcake' || shape === 'gumball') {
    if (shape === 'gumball') {
      box(ctx, 10, 8, 12, 12, '#b8d7df');
      for (let i = 0; i < 7; i++) p(ctx, 12 + (i * 3) % 8, 10 + (i * 5) % 8, i % 2 ? pal.accent : pal.light);
      box(ctx, 12, 20, 8, 7, pal.dark);
    } else {
      box(ctx, 10, 17, 12, 8, pal.mid);
      r(ctx, 12, 13, 8, 5, shape === 'cupcake' ? pal.accent : pal.light);
      p(ctx, 16, 12, BASE.white);
    }
  } else if (shape === 'cart') {
    box(ctx, 8, 13, 16, 12, pal.mid);
    r(ctx, 10, 16, 12, 2, BASE.ink);
    p(ctx, 11, 26, BASE.ink);
    p(ctx, 21, 26, BASE.ink);
  } else if (shape === 'pillow' || shape === 'cushion' || shape === 'plushie') {
    box(ctx, 8, 15, 16, 10, pal.light);
    r(ctx, 11, 17, 10, 5, pal.accent);
    if (shape === 'plushie') {
      p(ctx, 13, 18, BASE.ink);
      p(ctx, 19, 18, BASE.ink);
    }
  } else {
    box(ctx, 9, 15, 14, 11, pal.mid);
    r(ctx, 12, 12, 8, 4, pal.light);
    p(ctx, 16, 18, pal.accent);
  }
}

function drawIdentityPixels(ctx: CanvasRenderingContext2D, def: BuiltinPixelFurnitureDef, pal: DrawPalette) {
  const h = hash(def.id) >>> 0;
  for (let i = 0; i < 3; i++) {
    const x = 6 + ((h >> (i * 3)) % 20);
    const y = 6 + ((h >> (i * 5)) % 20);
    p(ctx, x, y, i % 2 ? pal.accent : pal.light);
  }
}
