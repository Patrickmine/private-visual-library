# 四维分类与文件契约

## 分类口径

`category` 指图片主要商品的产品品类。用本次全部图片汇总清单，不预设上一批的枕头、被子或净水器，也不以用途分类替代产品品类。名称保持同层级，并给出简明定义。用户的命名、合并、拆分要求优先；仅修正受影响的归属及清单。

无法确定主要商品时用 `未指定品类`。例如局部填充物无法推出最终是枕头还是被子；饮品配方没有呈现设备，不能仅凭来源猜净水器。可识别为净水器的渲染图仍归净水器。这是可正常浏览的保留分组，不强制要求用户补充逐图信息。

`imageType`、`composition`、`background` 的可用值、中文名与定义固定在 `assets/visual-taxonomy.json`。看图前读取此文件，不新增维度或改标准。各维度选一个主要值：

- 图片类型：按主导表达选择。明确比较对象用 COMPARISON；尺寸或适配规格为主用 DIMENSION；只有局部特写不自动算 DETAIL，若主导功能说明可算 FEATURE。品牌承诺不等于具体卖点。
- 构图：按独立内容区判断。普通文字叠加可仍是 SINGLE FRAME；主画面附小窗是 MAIN & INSET；左右/上下独立分区和多格布局按定义区分。
- 背景：按主要承载画面的背景判断。文字、箭头和标注本身不算 GRAPHIC。真实卧室/厨房/户外是 ENVIRONMENT，展示台座或人工布景是 STAGED；混合画面记录选择依据。

原图低清时不要放大后编造不可辨认细节。允许品类未知；若整张图片无法查看，不能伪造三个视觉维度，记录问题并解决输入或由用户明确调整范围后新建清单。

判断把握是 Agent 定性记录，不是准确率。图片上的参数或认证仅是分类证据，不是已验证的产品事实。

## 输入清单

由 `inventory` 命令生成，不手工伪造文件哈希和尺寸。清单包含绝对输入目录、相对文件名、本批 ID、SHA-256、尺寸，以及拒绝项和非图片项。ID 可能随新增文件排序改变，不能用跨批 ID 匹配用户修正。扫描不执行 AI 分类，也不证明图片内容已经可视查看。

## review.json

写入清单文件的原字节 SHA-256。只有全部图片实际查看完才能使用 `visual_review_complete`。`categories` 仅列本批商品品类，保留分组由生成器自动添加。每张图片 ID 与清单一对一。

```json
{
  "status": "visual_review_complete",
  "inventory_sha256": "清单文件的SHA-256",
  "categories": [
    {"value": "用户待确认的品类名", "zh": "同一中文品类名", "definition": "产品范围与边界"}
  ],
  "items": [
    {
      "id": 1,
      "visual_status": "reviewed",
      "category": "用户待确认的品类名",
      "imageType": "FEATURE",
      "composition": "SINGLE FRAME",
      "background": "SOLID",
      "confidence": "中",
      "evidence": {
        "category": "实际可见商品依据",
        "imageType": "主导表达依据",
        "composition": "内容区关系",
        "background": "主要背景依据"
      }
    }
  ]
}
```

## approval.json

生成前必须取得真实用户确认。此记录证明 Agent 保存了对应的确认口径，并非身份认证或防伪签名。脚本不能代替 Agent 判断用户是否实际授权。

```json
{
  "status": "confirmed",
  "inventory_sha256": "同一清单文件的SHA-256",
  "category_sha256": "规范化categories数组的SHA-256",
  "reserved_group": "未指定品类",
  "user_quote": "用户实际确认本批品类时的原话",
  "scope": "品类清单确认，不代表逐图准确性审核"
}
```

规范化哈希的算法为 Python：

```python
hashlib.sha256(json.dumps(categories, ensure_ascii=False, sort_keys=True,
                          separators=(',', ':')).encode('utf-8')).hexdigest()
```

用户调整品类清单后更新 review 与对应确认，不重跑无关的三个维度。新增图片属于新批次，需要完成新增批次识别后展示其品类清单。

## 逐图用户修正与继承

用户明确修改某张图片的品类时，在该图片的 review 行添加 `user_correction`，保存其实际原话：

```json
"user_correction": {"category": "被子", "user_quote": "425为被子"}
```

不要为 AI 自己的判断添加此字段，也不要把整批“确认”当成逐图修正。该字段的 category 必须等于该行 category。批量命名或归属修正只有在用户实际明确指向这些图片时，才为受影响的图片记录相同原话。

生成器把每张图片的原相对文件名、内容哈希、四维判断、依据和用户修正历史写入网站目录内的 `classification-record.json`，并纳入生成文件校验。记录不依赖临时工作目录。它保存 Agent 记录的用户原话，不是身份认证，也不能证明 AI 分类准确。

继续生成新版时先运行 `inherit`，用新清单的相对文件名和内容 SHA-256 同时匹配旧记录。目录可以改变；同名图片内容改变、文件更名或新增图片不自动继承，不能仅凭编号相邻扩散修正。取得继承结果后，Agent 先更新候选归属再展示本批品类清单；不自动沿用旧批确认。

给 `build` 传入相同 `--previous-library`，生成器将继承历史写入新版，并拒绝没有新用户修正依据的冲突归属。用户明确再次修正时，记录新的 `user_correction`，新版保留先前历史并添加此次修正。后三维度的标准不变；仍遵守实际看图要求。

旧图库没有此记录时，启动和浏览不受影响；继承命令会明确报缺失，不把旧 AI 分类猜成用户修正。若用户提供旧审阅记录，Agent 可从中恢复真实修正原话，再按本批数据契约生成新版，不改写旧图库。

## 输出

输出保持原结构：`index.html`、`app.js`、`styles.css`、`references.json`、`taxonomy.json`、`images/`，包含供检查用的 `generation-record.json` 和随图库保存的 `classification-record.json`。模板逐字节复制；图片原字节复制，文件名统一为安全的序号名，不做压缩或格式转换。

原模板需要本地 HTTP：module 入口通过 fetch 读取两个 JSON。不改模板为内嵌版本，也不把 file:// 成功视为前提。`check` 比较 HTTP 与磁盘哈希，避免把同端口的其他图库误报成本次结果。数据或输出版本改变后使用新目录，不覆盖关键旧版。

当前范围为新建图库和启动恢复。追加图片、跨平台安装发行、移动目录自动发现、后台常驻服务不在此候选中隐式实现。
