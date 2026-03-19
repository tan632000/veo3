# Research & Design Decisions — veo3-bulk-video

---
**Purpose**: Ghi nhận các phát hiện từ quá trình discovery, quyết định kiến trúc, và lý do chọn giải pháp.

---

## Summary
- **Feature**: `veo3-bulk-video`
- **Discovery Scope**: New Feature (Greenfield)
- **Key Findings**:
  - Chrome Extension MV3 bắt buộc dùng Service Worker thay backgroud page, Side Panel API sẵn có cho UI persistent
  - Content Script có thể thao tác DOM của Google Flow nhưng chạy trong isolated world — không truy cập được JS variables của trang
  - Trích xuất last frame từ video: dùng canvas `drawImage()` sau khi seek video tới `duration`, hoạt động tốt trên Chrome

## Research Log

### Chrome Extension Manifest V3 Architecture
- **Context**: Cần hiểu kiến trúc MV3 để thiết kế extension đúng chuẩn
- **Sources Consulted**: Chrome Developers docs, dev.to, medium.com
- **Findings**:
  - Service Worker thay thế background page (event-driven, không persistent)
  - Content Scripts chạy trong isolated world — truy cập DOM nhưng không truy cập JS context của page
  - Side Panel API (`chrome.sidePanel`) cho phép UI persistent bên cạnh web page — phù hợp cho dashboard điều khiển batch
  - Message passing giữa Service Worker ↔ Content Script ↔ Side Panel qua `chrome.runtime.sendMessage` / `chrome.tabs.sendMessage`
  - Không được dùng remote code, eval(), hoặc inline script
- **Implications**: Kiến trúc 3 layer: Side Panel (UI) → Service Worker (orchestrator) → Content Script (DOM automation)

### Google Flow / Veo3 DOM Interaction
- **Context**: Extension cần tự động hóa thao tác trên giao diện Google Flow
- **Sources Consulted**: Google Flow documentation, YouTube tutorials
- **Findings**:
  - Google Flow hỗ trợ "Frames to Video" — upload image làm first/last frame
  - Giao diện web-based, các element có thể query bằng CSS selectors
  - Video kết quả hiển thị trong `<video>` element trên page
  - DOM có thể thay đổi qua các bản cập nhật Google — cần design selector strategy linh hoạt
- **Implications**: Content Script cần selector mapping có thể cập nhật dễ dàng; cần MutationObserver để detect completion

### Video Frame Extraction
- **Context**: Cần trích xuất frame cuối cùng từ video element để chain
- **Sources Consulted**: MDN Web Docs, Stack Overflow
- **Findings**:
  - Phương pháp: seek `video.currentTime = video.duration` → listen `seeked` event → `canvas.drawImage(video)` → `canvas.toDataURL('image/png')`
  - Cross-origin video có thể bị tainted canvas — nhưng content script chạy trên cùng origin nên OK
  - Alternatively: download video blob → create offscreen video element → seek & capture
  - Canvas approach được support rộng rãi trên Chrome
- **Implications**: Ưu tiên canvas approach trực tiếp; fallback sang download+extract nếu video element bị restricted

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| Side Panel + Service Worker + Content Script | 3-layer MV3 standard | Clear separation, persistent UI, event-driven | Service Worker có thể bị terminate khi idle | Dùng alarm API để keep alive khi batch đang chạy |
| Popup-only | Chỉ dùng popup cho UI | Đơn giản | Popup đóng khi click ngoài, mất state | Không phù hợp cho long-running batch |
| DevTools Panel | Dùng DevTools panel | Persistent khi DevTools mở | Yêu cầu mở DevTools, UX kém | Quá phức tạp cho use case này |

**Selected**: Side Panel + Service Worker + Content Script

## Design Decisions

### Decision: Side Panel thay vì Popup
- **Context**: Cần UI persistent trong khi batch đang chạy
- **Alternatives Considered**:
  1. Popup — đóng khi click ngoài, mất context
  2. New tab — tách rời khỏi page đang thao tác
- **Selected Approach**: Side Panel API — UI persistent bên cạnh Google Flow
- **Rationale**: Cho phép user theo dõi progress trong khi video đang generate trên trang chính
- **Trade-offs**: Side Panel API chỉ có trên Chrome 114+, nhưng đây là Chrome extension nên OK

### Decision: Canvas approach cho frame extraction
- **Context**: Cần trích xuất last frame từ video result
- **Alternatives Considered**:
  1. Canvas drawImage — đơn giản, browser-native
  2. WebCodecs API — mạnh hơn nhưng phức tạp
  3. Download + FFmpeg WASM — nặng, chậm
- **Selected Approach**: Canvas drawImage sau khi seek tới cuối video
- **Rationale**: Đơn giản, nhanh, không cần dependency ngoài
- **Trade-offs**: Phụ thuộc vào video element accessible trên page

### Decision: Selector mapping configurable
- **Context**: DOM Google Flow có thể thay đổi qua updates
- **Selected Approach**: Tách selector definitions ra file riêng, dễ cập nhật
- **Rationale**: Giảm maintenance cost khi Google thay đổi UI

## Risks & Mitigations
- **Google Flow DOM thay đổi** — Selector mapping tách riêng, dễ update; thêm validation check khi inject
- **Service Worker bị terminate giữa batch** — Dùng `chrome.alarms` API để periodic wake-up; lưu state vào chrome.storage
- **Cross-origin restriction trên video** — Content script chạy trên cùng origin; fallback sang download blob nếu cần
- **Rate limiting từ Google Flow** — Thêm configurable delay giữa các lần generate

## Validation Log

### Session 1 — 2026-03-19
- Questions asked: 5

1. [Architecture] UI dùng Side Panel hay Popup?
   - Options: A) Side Panel | B) Popup | C) Cả hai
   - Answer: A) Side Panel
   - Rationale: UI persistent, theo dõi progress real-time mà không cần click mở

2. [Error Recovery] Khi video generate thất bại?
   - Options: A) Retry 3x → skip, dùng last good frame | B) Retry 3x → dừng batch | C) Không retry, skip ngay
   - Answer: A) Retry 3 lần → skip, dùng last good frame cho video tiếp
   - Rationale: Chain không bị đứt, batch tiếp tục tự động

3. [Scope] Batch size tối đa?
   - Options: A) 50 prompts | B) 20 prompts | C) Không giới hạn
   - Answer: A) 50 prompts
   - Rationale: Đủ cho hầu hết use cases, trong giới hạn storage 10MB

4. [Integration] Cách detect video hoàn thành trên Google Flow?
   - Options: A) MutationObserver | B) Polling DOM | C) Kết hợp cả hai
   - Answer: A) MutationObserver
   - Rationale: Event-driven, real-time, tiết kiệm tài nguyên

5. [Frame Chain] Khi video đầu tiên lỗi (không có frame trước đó)?
   - Options: A) Dùng first frame config nếu có, text-to-video nếu không | B) Dừng batch | C) Skip, text-to-video
   - Answer: A) Dùng first frame config nếu có, nếu không thì text-to-video
   - Rationale: Tối đa hóa khả năng tiếp tục batch tự động

#### Confirmed Decisions
- Side Panel làm UI chính (persistent)
- Retry 3 lần → skip prompt lỗi, giữ chain bằng last good frame
- Max 50 prompts per batch
- MutationObserver cho completion detection
- Fallback chain: first frame config → text-to-video khi không có frame

#### Follow-up Actions
- [ ] Xác nhận CSS selectors thực tế trên Google Flow khi bắt đầu implement
- [ ] Test MutationObserver behavior trên Google Flow page

## References
- [Chrome MV3 Overview](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
- [Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
- [Content Scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [Canvas drawImage](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/drawImage)
- [Google Flow / Veo3](https://labs.google/flow)
