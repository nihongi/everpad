# evernote-backup のデータベース(en_backup.db)を読んで、ノートを1件ずつ JSON の行で書き出す(tools/import-evernote.js が使う)。
# Python の標準ライブラリだけで動く。データベースは読むだけで、書き換えない。
#   python evernote-dump.py <en_backup.db> <添付を書き出すフォルダ> [--trash]
# 標準出力: 1行に1つの JSON(ASCII)。最初の行は {"kind": "info", ...}、ノートは {"kind": "note", ...}、最後は {"kind": "end", ...}
# 添付の中身は <添付を書き出すフォルダ>/<ノートの番号>-<添付の番号> に書き、行にはそのファイル名を入れる。
# evernote-backup はノートを、Evernote の SDK の Note(Thrift の型)を pickle にして lzma で縮めて持つ。
# pickle を読むときは、evernote の型だけを中身を入れるだけの入れ物にして読み、ほかの型(コードを動かせるもの)は読まない。
import io
import json
import lzma
import os
import pickle
import sqlite3
import sys


class Plain:
    def __init__(self, *args, **kwargs):
        pass

    def __setstate__(self, state):
        if isinstance(state, tuple):
            state = state[0] or {}
        self.__dict__.update(state or {})


ALLOWED = {('builtins', 'set'), ('builtins', 'frozenset'), ('builtins', 'object'), ('copyreg', '_reconstructor')}


class SafeUnpickler(pickle.Unpickler):
    def find_class(self, module, name):
        if module == 'evernote' or module.startswith('evernote.'):
            return type(name, (Plain,), {})
        if (module, name) in ALLOWED:
            return getattr(__import__(module), name)
        raise pickle.UnpicklingError('読まない型です: ' + module + '.' + name)


def load(raw):
    return SafeUnpickler(io.BytesIO(lzma.decompress(raw))).load()


def fields(obj):
    return getattr(obj, '__dict__', None) or {}


def out(obj):
    sys.stdout.buffer.write(json.dumps(obj, ensure_ascii=True).encode('ascii') + b'\n')


def main(argv):
    args = [a for a in argv if not a.startswith('--')]
    if len(args) != 2:
        sys.stderr.write('使い方: python evernote-dump.py <en_backup.db> <添付を書き出すフォルダ> [--trash]\n')
        return 2
    db_path, res_dir = args
    trash = '--trash' in argv
    os.makedirs(res_dir, exist_ok=True)
    db = sqlite3.connect('file:' + db_path.replace('\\', '/') + '?mode=ro', uri=True)
    version = db.execute("SELECT value FROM config WHERE name = 'DB_VERSION'").fetchone()
    notebooks = {g: {'name': n or '', 'stack': s or ''} for g, n, s in db.execute('SELECT guid, name, stack FROM notebooks')}
    rows = db.execute('SELECT COUNT(*) FROM notes WHERE raw_note IS NOT NULL' + ('' if trash else ' AND is_active')).fetchone()[0]
    out({'kind': 'info', 'dbVersion': version[0] if version else None, 'notes': rows})
    query = 'SELECT guid, notebook_guid, is_active, raw_note FROM notes WHERE raw_note IS NOT NULL' + ('' if trash else ' AND is_active') + ' ORDER BY guid'
    k = 0
    for guid, nb_guid, active, raw in db.execute(query):
        k += 1
        try:
            n = fields(load(raw))
        except Exception as e:
            out({'kind': 'error', 'guid': guid, 'message': str(e)})
            continue
        attrs = fields(n.get('attributes'))
        resources = []
        for j, r in enumerate(n.get('resources') or []):
            rf = fields(r)
            data = fields(rf.get('data'))
            body = data.get('body')
            ra = fields(rf.get('attributes'))
            item = {'mime': rf.get('mime') or '', 'fileName': ra.get('fileName') or '',
                    'hash': (data.get('bodyHash') or b'').hex() if isinstance(data.get('bodyHash'), bytes) else '',
                    'width': rf.get('width') or 0, 'height': rf.get('height') or 0}
            if body:
                name = '%d-%d' % (k, j)
                with open(os.path.join(res_dir, name), 'wb') as f:
                    f.write(body)
                item['file'] = name
                item['size'] = len(body)
            resources.append(item)
        nb = notebooks.get(nb_guid, {'name': '', 'stack': ''})
        out({'kind': 'note', 'guid': guid, 'active': bool(active), 'title': n.get('title') or '',
             'notebook': nb['name'], 'stack': nb['stack'],
             'created': n.get('created') or 0, 'updated': n.get('updated') or 0,
             'tags': list(n.get('tagNames') or []), 'sourceURL': attrs.get('sourceURL') or '',
             'contentClass': attrs.get('contentClass') or '',
             'content': n.get('content') or '', 'resources': resources})
    out({'kind': 'end', 'notes': k})
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
