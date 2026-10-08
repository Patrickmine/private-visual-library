#!/usr/bin/env python3
"""Inventory, assemble and serve the fixed library. AI review remains in the Agent."""
import argparse
import hashlib
import http.server
import json
import os
from pathlib import Path
import shutil
import struct
import sys
import tempfile
from urllib.parse import quote
from urllib.request import urlopen

ASSETS = Path(__file__).resolve().parents[1] / 'assets'
FIELDS = ('imageType', 'composition', 'background')
EXTENSIONS = {'.png', '.jpg', '.jpeg', '.webp'}
OTHER_IMAGES = {'.gif', '.heic', '.heif', '.avif', '.svg', '.tif', '.tiff', '.bmp'}
RESERVED = {'value': '未指定品类', 'zh': '未指定品类',
            'definition': '图中信息不足以确定主要商品品类；保留图片，不等于商品识别成功。'}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return digest(json.dumps(value, ensure_ascii=False, sort_keys=True,
                             separators=(',', ':')).encode('utf-8'))


def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def write_new(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x', encoding='utf-8') as f:
        json.dump(value, f, ensure_ascii=False, indent=2)
        f.write('\n')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def jpeg_orientation(segment):
    if not segment.startswith(b'Exif\0\0'):
        return 1
    tiff = segment[6:]
    require(len(tiff) >= 8, '损坏的 JPEG EXIF')
    endian = '<' if tiff[:2] == b'II' else '>'
    require(tiff[:2] in (b'II', b'MM'), '损坏的 JPEG EXIF 字节序')
    offset = struct.unpack_from(endian + 'I', tiff, 4)[0]
    count = struct.unpack_from(endian + 'H', tiff, offset)[0]
    for i in range(count):
        pos = offset + 2 + i * 12
        tag, kind, size = struct.unpack_from(endian + 'HHI', tiff, pos)
        if tag == 0x112 and kind == 3 and size == 1:
            return struct.unpack_from(endian + 'H', tiff, pos + 8)[0]
    return 1


def image_info(data):
    # Dimensions only. Successful header reading does not prove visual readability.
    if data.startswith(b'\x89PNG\r\n\x1a\n'):
        require(data[12:16] == b'IHDR', '损坏的 PNG 文件头')
        width, height = struct.unpack_from('>II', data, 16)
        kind = '.png'
    elif data.startswith(b'\xff\xd8'):
        pos, orientation, dimensions = 2, 1, None
        while pos < len(data):
            require(data[pos] == 255, '损坏的 JPEG 标记')
            while pos < len(data) and data[pos] == 255:
                pos += 1
            marker = data[pos]
            pos += 1
            if marker in (0xD9, 0xDA):
                break
            if marker in (0x01, *range(0xD0, 0xD9)):
                continue
            length = struct.unpack_from('>H', data, pos)[0]
            require(length >= 2 and pos + length <= len(data), '损坏的 JPEG 段')
            segment = data[pos + 2:pos + length]
            if marker == 0xE1:
                orientation = jpeg_orientation(segment)
            if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7,
                          0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                height, width = struct.unpack_from('>HH', segment, 1)
                dimensions = (width, height)
            pos += length
        require(dimensions is not None, 'JPEG 缺少尺寸信息')
        width, height = dimensions
        if orientation in (5, 6, 7, 8):
            width, height = height, width
        kind = '.jpg'
    elif data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        chunk, content = data[12:16], data[20:]
        if chunk == b'VP8X':
            require(not content[0] & 2, '本候选不处理动画 WebP')
            width = 1 + int.from_bytes(content[4:7], 'little')
            height = 1 + int.from_bytes(content[7:10], 'little')
        elif chunk == b'VP8L':
            require(content[0] == 47, '损坏的无损 WebP')
            bits = int.from_bytes(content[1:5], 'little')
            width, height = (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
        elif chunk == b'VP8 ':
            require(content[3:6] == b'\x9d\x01\x2a', '损坏的 WebP')
            width, height = struct.unpack_from('<HH', content, 6)
            width, height = width & 0x3FFF, height & 0x3FFF
        else:
            raise ValueError('无法读取此 WebP 尺寸')
        kind = '.webp'
    else:
        raise ValueError('不支持的格式；本候选支持 PNG、JPEG、静态 WebP')
    require(0 < width <= 100000 and 0 < height <= 100000, '无效图片尺寸')
    return width, height, kind


def inventory(args):
    root = Path(args.input).resolve()
    require(root.is_dir(), '输入应为图片文件夹')
    items, rejected, ignored = [], [], []
    for path in sorted(root.rglob('*'), key=lambda p: p.relative_to(root).as_posix()):
        relative = path.relative_to(root).as_posix()
        if path.is_symlink():
            rejected.append({'file': relative, 'reason': '不处理符号链接；请提供实际图片'})
            continue
        if not path.is_file():
            continue
        if path.suffix.lower() not in EXTENSIONS | OTHER_IMAGES:
            ignored.append(relative)
            continue
        try:
            data = path.read_bytes()
            width, height, ext = image_info(data)
            items.append({'id': len(items) + 1, 'file': relative,
                          'sha256': digest(data), 'width': width, 'height': height,
                          'extension': ext})
        except (ValueError, IndexError, struct.error, OSError) as exc:
            rejected.append({'file': relative, 'reason': str(exc)})
    result = {'schema_version': 1, 'input_root': str(root), 'items': items,
              'rejected': rejected, 'ignored_non_images': ignored,
              'status': 'ready_for_visual_review' if items and not rejected else 'blocked'}
    write_new(args.output, result)
    print(json.dumps({'inventory': str(Path(args.output).resolve()),
                      'images': len(items), 'rejected': rejected}, ensure_ascii=False))
    return 0 if result['status'] == 'ready_for_visual_review' else 2


def verified_assets():
    hashes = read_json(ASSETS / 'template-hashes.json')
    for name in ('index.html', 'app.js', 'styles.css', 'visual-taxonomy.json'):
        path = ASSETS / name if name.endswith('.json') else ASSETS / 'template' / name
        require(digest(path.read_bytes()) == hashes[name], '固定资产变化：' + name)
    return read_json(ASSETS / 'visual-taxonomy.json'), hashes


def categories_from(review):
    categories = review['categories']
    require(isinstance(categories, list) and categories, '品类清单为空')
    values = []
    for category in categories:
        for key in ('value', 'zh', 'definition'):
            require(isinstance(category.get(key), str) and category[key].strip(),
                    '品类必须包含非空 value、zh、definition')
        require(category['value'] != RESERVED['value'], '保留分组由脚本添加，不作为商品品类')
        values.append(category['value'])
    require(len(set(values)) == len(values), '品类名称重复')
    return categories


def correction(value):
    require(isinstance(value, dict), '用户修正应为记录对象')
    for key in ('category', 'user_quote'):
        require(isinstance(value.get(key), str) and value[key].strip(),
                '用户修正必须保存品类及真实用户原话')
    return {key: value[key] for key in ('category', 'user_quote')}


def inherited_corrections(inv, previous_library):
    if not previous_library:
        return {}
    root = Path(previous_library).resolve()
    path = root / 'classification-record.json'
    require(path.is_file(), '旧图库没有逐图修正记录；请提供旧审阅记录，不猜测用户修正')
    manifest = read_json(root / 'generation-record.json')
    require(manifest.get('files', {}).get(path.name) == digest(path.read_bytes()),
            '旧图库分类记录发生变化，请先核对')
    record = read_json(path)
    require(record.get('schema_version') == 1 and isinstance(record.get('items'), list),
            '无法读取旧图库分类记录')
    previous, seen = {}, set()
    for item in record['items']:
        key = (item['source_file'], item['source_sha256'])
        require(key not in seen, '旧图库图片记录重复')
        seen.add(key)
        history = item.get('user_corrections', [])
        require(isinstance(history, list), '旧图库用户修正记录应为列表')
        history = [correction(value) for value in history]
        if history:
            require(item['category'] == history[-1]['category'], '旧图库品类与用户修正不一致')
            previous[key] = history
    return {item['id']: previous[(item['file'], item['sha256'])]
            for item in inv['items'] if (item['file'], item['sha256']) in previous}


def inherit(args):
    inventory_path = Path(args.inventory)
    inv = read_json(inventory_path)
    require(inv['status'] == 'ready_for_visual_review' and not inv['rejected'], '输入清单尚未就绪')
    matched = inherited_corrections(inv, args.previous_library)
    result = {'schema_version': 1, 'inventory_sha256': digest(inventory_path.read_bytes()),
              'match_rule': 'same_relative_file_and_sha256',
              'items': [{'id': item['id'], 'source_file': item['file'],
                         'source_sha256': item['sha256'],
                         'category': matched[item['id']][-1]['category'],
                         'user_corrections': matched[item['id']]}
                        for item in inv['items'] if item['id'] in matched]}
    write_new(args.output, result)
    print(json.dumps({'inherited_corrections': len(matched),
                      'output': str(Path(args.output).resolve())}, ensure_ascii=False))
    return 0


def build(args):
    inventory_path = Path(args.inventory)
    inv = read_json(inventory_path)
    review, approval = read_json(args.review), read_json(args.approval)
    visual, template_hashes = verified_assets()
    require(inv['status'] == 'ready_for_visual_review' and not inv['rejected'], '输入清单尚未就绪')
    inv_hash = digest(inventory_path.read_bytes())
    require(review.get('inventory_sha256') == inv_hash, '分类不属于当前输入清单')
    require(review.get('status') == 'visual_review_complete', '尚未完成全部图片看图判断')
    categories = categories_from(review)
    require(approval.get('status') == 'confirmed' and
            isinstance(approval.get('user_quote'), str) and approval['user_quote'].strip(),
            '未取得实际用户品类确认；不能生成')
    require(approval.get('inventory_sha256') == inv_hash and
            approval.get('category_sha256') == canonical(categories), '确认记录与当前批次或品类不匹配')
    require(approval.get('reserved_group') == RESERVED['value'], '缺少未指定品类保留分组记录')
    items, rows = inv['items'], review['items']
    inherited = inherited_corrections(inv, args.previous_library)
    ids = [item['id'] for item in items]
    require(ids and len(set(ids)) == len(ids), '输入 ID 为空或重复')
    row_ids = [row['id'] for row in rows]
    require(len(row_ids) == len(set(row_ids)) and set(row_ids) == set(ids),
            '分类记录必须完整且一对一匹配所有图片')
    row_map = {row['id']: row for row in rows}
    category_values = {entry['value'] for entry in categories} | {RESERVED['value']}
    root = Path(inv['input_root']).resolve()
    sources, references, classification_rows = [], [], []
    for item in items:
        row = row_map[item['id']]
        require(row.get('visual_status') == 'reviewed', '图片尚未实际看图：' + str(item['id']))
        require(row.get('category') in category_values, '图片引用未知品类')
        history = list(inherited.get(item['id'], []))
        if 'user_correction' in row:
            latest = correction(row['user_correction'])
            require(latest['category'] == row['category'], '用户修正与图片品类不一致')
            if not history or latest != history[-1]:
                history.append(latest)
        if history:
            require(history[-1]['category'] == row['category'],
                    '不能覆盖已保存的用户修正；请沿用修正，或记录用户的新修正：' + item['file'])
        for field in FIELDS:
            require(row.get(field) in {entry['value'] for entry in visual[field]}, '未知维度值：' + field)
        for field in ('category', *FIELDS):
            evidence = row.get('evidence', {}).get(field)
            require(isinstance(evidence, str) and evidence.strip(), '缺少看图依据：' + field)
        source = root / item['file']
        require(not source.is_symlink() and source.resolve().is_relative_to(root), '图片路径越界')
        data = source.read_bytes()
        require(digest(data) == item['sha256'], '输入图片已改变，请重新清点：' + item['file'])
        width, height, ext = image_info(data)
        require((width, height, ext) == (item['width'], item['height'], item['extension']), '输入尺寸记录不符')
        name = 'images/reference-' + str(item['id']).zfill(4) + ext
        references.append({'id': item['id'], 'image': name, 'category': row['category'],
                           **{field: row[field] for field in FIELDS}, 'width': width,
                           'height': height, 'sourceFile': item['file']})
        classification_rows.append({'source_file': item['file'],
                                    'source_sha256': item['sha256'],
                                    'category': row['category'],
                                    **{field: row[field] for field in FIELDS},
                                    'confidence': row.get('confidence'),
                                    'evidence': row['evidence'],
                                    'user_corrections': history})
        sources.append((data, name))
    output = Path(args.output).absolute()
    require(not output.exists(), '输出目录已存在，请使用新版本目录')
    output.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix='.' + output.name + '-', dir=output.parent))
    try:
        (stage / 'images').mkdir()
        for name in ('index.html', 'app.js', 'styles.css'):
            shutil.copyfile(ASSETS / 'template' / name, stage / name)
        for data, name in sources:
            (stage / name).write_bytes(data)
        write_new(stage / 'references.json', references)
        write_new(stage / 'taxonomy.json', {'category': [*categories, RESERVED], **visual})
        write_new(stage / 'classification-record.json',
                  {'schema_version': 1, 'inventory_sha256': inv_hash,
                   'categories': categories, 'items': classification_rows})
        record = {'schema_version': 1, 'inventory_sha256': inv_hash,
                  'category_confirmation': approval, 'template_hashes': template_hashes,
                  'image_count': len(items),
                  'files': {p.relative_to(stage).as_posix(): digest(p.read_bytes())
                            for p in sorted(stage.rglob('*')) if p.is_file()}}
        write_new(stage / 'generation-record.json', record)
        require(not output.exists(), '输出目录被其他操作占用')
        os.rename(stage, output)
    except BaseException:
        shutil.rmtree(stage, ignore_errors=True)
        raise
    print(json.dumps({'output': str(output), 'images': len(references)}, ensure_ascii=False))
    return 0


def check(args):
    root = Path(args.directory).resolve()
    record = read_json(root / 'generation-record.json')
    results = []
    for name, sha in record['files'].items():
        require(digest((root / name).read_bytes()) == sha, '生成文件发生变化：' + name)
        url = 'http://127.0.0.1:' + str(args.port) + '/' + quote(name)
        with urlopen(url, timeout=5) as response:
            body, status = response.read(), response.status
        require(status == 200 and digest(body) == sha, 'HTTP 资源不属于当前图库：' + name)
        results.append({'resource': name, 'status': status, 'sha256': sha})
    result = {'transport': 'HTTP', 'url': 'http://127.0.0.1:' + str(args.port) + '/',
              'image_count': record['image_count'], 'resources': results,
              'browser_interactions': 'not_checked_by_this_command'}
    if args.evidence:
        write_new(args.evidence, result)
    print(json.dumps(result, ensure_ascii=False))
    return 0


def serve(args):
    root = Path(args.directory).resolve()
    require((root / 'index.html').is_file() and (root / 'references.json').is_file(), '不是生成的图库目录')
    handler = lambda *a, **kw: http.server.SimpleHTTPRequestHandler(*a, directory=str(root), **kw)
    with http.server.ThreadingHTTPServer(('127.0.0.1', args.port), handler) as server:
        print('图库：' + str(root) + '\n地址：http://127.0.0.1:' + str(args.port) + '/', flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    scan = commands.add_parser('inventory')
    scan.add_argument('--input', required=True)
    scan.add_argument('--output', required=True)
    assemble = commands.add_parser('build')
    for key in ('inventory', 'review', 'approval', 'output'):
        assemble.add_argument('--' + key, required=True)
    assemble.add_argument('--previous-library')
    reuse = commands.add_parser('inherit')
    for key in ('inventory', 'previous-library', 'output'):
        reuse.add_argument('--' + key, required=True)
    for name in ('serve', 'check'):
        command = commands.add_parser(name)
        command.add_argument('--directory', required=True)
        command.add_argument('--port', type=int, default=4317)
        if name == 'check':
            command.add_argument('--evidence')
    args = parser.parse_args()
    try:
        if hasattr(args, 'port'):
            require(1024 <= args.port <= 65535, '端口应在 1024–65535 之间')
        return {'inventory': inventory, 'inherit': inherit, 'build': build,
                'serve': serve, 'check': check}[args.command](args)
    except (ValueError, OSError, KeyError, TypeError, IndexError, struct.error) as exc:
        print('失败：' + str(exc), file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
