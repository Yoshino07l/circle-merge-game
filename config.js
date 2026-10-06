/* 所有可修改参数集中在此；替换图片时不需要改物理代码。 */
(function (root) {
  'use strict';
  const config = {
    title: '合成圆圆',
    width: 420,
    height: 700,
    wall: 10,
    dropY: 68,
    dangerY: 142,
    gravity: 2200,
    restitution: 0.22,      // 球与球轻微弹跳；0 = 不反弹
    wallRestitution: 0.18,  // 墙壁、地面轻微弹跳
    friction: 0.18,         // 接触摩擦，由 0.35 降低
    groundDrag: 4,          // 地面水平阻力，按时间作用，不按求解次数重复衰减
    bounceThreshold: 90,    // 低速接触不反弹，防止静止堆叠持续微抖
    assetRevision: 'photos-20261006',
    dropInterval: 0.36,
    dangerTime: 1.5,
    restSpeed: 140,
    maxBonus: 100,
    spawnWeights: [0.28, 0.24, 0.20, 0.16, 0.12],
    mergeScores: [0, 1, 3, 6, 10, 15, 21, 28, 36, 45, 55],
    // 原照片不修改；显示时仍裁成圆形。
    // 本次 11 张照片按文件名升序放入各级；不是体型或体重排名。
    // sourceFile 保存原始文件名，方便后续核对与替换。
    // 后续直接覆盖 assets/photos/01.jpg 至 11.jpg；大小只由 radius 控制。
    levels: [
      { name: '头像 01', sourceImage: 1, sourceFile: 'IMG_20251019_133400.jpg', radius: 17, color: '#bca7ef', image: 'assets/photos/01.jpg' },
      { name: '头像 02', sourceImage: 2, sourceFile: 'IMG_20251021_221705.jpg', radius: 23, color: '#f294a7', image: 'assets/photos/02.jpg' },
      { name: '头像 03', sourceImage: 3, sourceFile: 'IMG_20251021_221707.jpg', radius: 31, color: '#efae62', image: 'assets/photos/03.jpg' },
      { name: '头像 04', sourceImage: 4, sourceFile: 'IMG_20251021_221728.jpg', radius: 39, color: '#e9cf65', image: 'assets/photos/04.jpg' },
      { name: '头像 05', sourceImage: 5, sourceFile: 'IMG_20251025_222010.jpg', radius: 48, color: '#a6c77a', image: 'assets/photos/05.jpg' },
      { name: '头像 06', sourceImage: 6, sourceFile: 'IMG_20251025_222201_2.jpg', radius: 58, color: '#ed8974', image: 'assets/photos/06.jpg' },
      { name: '头像 07', sourceImage: 7, sourceFile: 'IMG_20260310_205104.jpg', radius: 69, color: '#f1b3c8', image: 'assets/photos/07.jpg' },
      { name: '头像 08', sourceImage: 8, sourceFile: 'IMG_20260310_205110.jpg', radius: 81, color: '#dfbd58', image: 'assets/photos/08.jpg' },
      { name: '头像 09', sourceImage: 9, sourceFile: 'IMG_20260601_185525.jpg', radius: 94, color: '#acbccc', image: 'assets/photos/09.jpg' },
      { name: '头像 10', sourceImage: 10, sourceFile: 'IMG_20260601_185526.jpg', radius: 108, color: '#87c9bd', image: 'assets/photos/10.jpg' },
      { name: '头像 11', sourceImage: 11, sourceFile: 'IMG_3111.jpg', radius: 124, color: '#789aa1', image: 'assets/photos/11.jpg' }
    ]
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = config;
  else root.MERGE_CONFIG = config;
})(typeof window === 'undefined' ? globalThis : window);
