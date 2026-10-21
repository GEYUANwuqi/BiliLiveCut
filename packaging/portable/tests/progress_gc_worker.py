from __future__ import annotations

import gc
import io
import json
import sys
import weakref
from concurrent.futures import ThreadPoolExecutor
from types import FrameType

from blc_portable.launcher import progress


class CollectingOutput(io.StringIO):
    def __init__(self) -> None:
        super().__init__()
        self.collect_on_write = False

    def write(self, text: str) -> int:
        if self.collect_on_write:
            self.collect_on_write = False
            gc.collect()
        return super().write(text)


def main(mode: str) -> None:
    """在序列化或输出边界触发真实 tqdm 回收，随后验证多线程事件完整性。"""
    output = CollectingOutput()
    original = sys.stdout
    sys.stdout = output
    gc.disable()
    bar = progress.hf_progress_class()(desc="gc-orphan", total=10, mininterval=0, file=io.StringIO())
    bar.update(3)
    bar.cycle = bar
    reference = weakref.ref(bar)
    del bar

    def collect_during_serialization(frame: FrameType, event: str, _argument: object) -> None:
        if event == "call" and frame.f_code is json.JSONEncoder.iterencode.__code__:
            sys.setprofile(None)
            gc.collect()

    if mode == "serialize":
        sys.setprofile(collect_during_serialization)
    else:
        output.collect_on_write = True
    progress.emit_progress("download", "outer", 1, 10)
    assert reference() is None

    def emit_batch(worker: int) -> None:
        for index in range(100):
            progress.emit_progress("download", f"worker-{worker}", index, 100)

    with ThreadPoolExecutor(max_workers=4) as executor:
        list(executor.map(emit_batch, range(4)))
    sys.stdout = original
    states = [json.loads(line.removeprefix(progress.PREFIX)) for line in output.getvalue().splitlines()]
    print(json.dumps(states), flush=True)


if __name__ == "__main__":
    main(sys.argv[1])
