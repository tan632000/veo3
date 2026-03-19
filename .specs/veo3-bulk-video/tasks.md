# Implementation Plan — veo3-bulk-video

## Requirements Coverage
| Requirement | Tasks |
|-------------|-------|
| 1 — Quản lý prompt | 3.1, 3.2 |
| 2 — Cấu hình ban đầu | 3.3 |
| 3 — Tự động thực thi | 4.1, 4.2 |
| 4 — Trích xuất frame & chain | 4.3 |
| 5 — Theo dõi & điều khiển | 5.1, 5.2 |
| 6 — Lưu trữ & lịch sử | 5.3 |
| 7 — Xử lý lỗi & phục hồi | 6.1 |
| 8 — Giao diện Extension | 3.1, 3.2, 3.3, 5.1 |

---

## Tasks

- [x] 1. Khởi tạo project Chrome Extension MV3
- [x] 1.1 Tạo cấu trúc extension cơ bản
  - Tạo manifest.json với Manifest V3: permissions (activeTab, sidePanel, storage, alarms), host permissions cho Google Flow
  - Tạo service worker entry point (background.js)
  - Tạo content script entry point (content.js) với match pattern cho Google Flow
  - Tạo side panel HTML/CSS/JS cơ bản
  - Thiết lập message passing giữa 3 layers (Service Worker ↔ Content Script ↔ Side Panel)
  - Verify extension load được trên Chrome qua chrome://extensions (unpacked)

- [x] 1.2 Xây dựng hệ thống message passing
  - Định nghĩa message protocol với các types: START_BATCH, PAUSE_BATCH, RESUME_BATCH, CANCEL_BATCH, EXECUTE_COMMAND, COMMAND_RESULT, STATE_UPDATE, PROGRESS_UPDATE, BATCH_COMPLETE, ERROR
  - Implement message handler trong Service Worker (router trung tâm)
  - Implement message sender/receiver trong Content Script
  - Implement message sender/receiver trong Side Panel
  - Thêm timestamp và source tracking cho mỗi message

---

- [x] 2. Xây dựng CSS selector mapping cho Google Flow
- [x] 2.1 Định nghĩa selector map
  - Tạo module selectors riêng chứa tất cả CSS selectors cho Google Flow page
  - Định nghĩa selectors cho: nút Frames to Video, vùng upload image, textarea prompt, nút Generate, container kết quả, video element, thông báo lỗi, loading indicator
  - Mỗi selector hỗ trợ mảng fallback alternatives (thử lần lượt cho tới khi match)
  - Thêm hàm validation kiểm tra selectors có tìm được element hay không
  - _Requirements: 3_

---

- [x] 3. Xây dựng Side Panel UI
- [x] 3.1 (P) Giao diện quản lý prompt
  - Tab "Prompts" với textarea nhập nhiều prompt (mỗi dòng 1 prompt)
  - Nút phân tách text thành danh sách prompt có thứ tự
  - Hiển thị danh sách prompt với khả năng sửa inline, xóa từng item, kéo thả sắp xếp
  - Badge hiển thị tổng số prompt trong danh sách
  - Mỗi prompt item hiển thị status icon: chờ (⏳), đang tạo (🔄), hoàn thành (✅), lỗi (❌)
  - Lưu/đọc prompt list từ chrome.storage.local
  - _Requirements: 1, 8_

- [x] 3.2 (P) Giao diện cấu hình batch
  - Tab "Cấu hình" với upload zone cho first frame image (preview thumbnail sau khi chọn)
  - Dropdown chọn aspect ratio (16:9 hoặc 9:16)
  - Input delay giữa các lần generate (ms, default 3000)
  - Input max retries (default 3)
  - Toggle skip on error (default true)
  - Lưu/đọc config từ chrome.storage.local
  - _Requirements: 2, 8_

- [x] 3.3 (P) Connection status và navigation
  - Badge trạng thái kết nối với Google Flow tab: connected (xanh), disconnected (đỏ), not-flow-page (xám)
  - Ping/detect content script trên tab active để xác định trạng thái
  - Disable nút Start khi chưa connected
  - Navigation giữa 4 tabs: Prompts, Config, Progress, History
  - _Requirements: 8_

---

- [x] 4. Xây dựng DOM automation và frame extraction (Content Script)
- [x] 4.1 Implement flow automator
  - Hàm chọn chế độ "Frames to Video" trên giao diện Google Flow (click nút tương ứng)
  - Hàm upload image làm first frame: tạo File object từ base64, inject vào input element qua DataTransfer API
  - Hàm điền prompt text vào textarea, trigger input/change events để page nhận giá trị
  - Hàm click nút Generate và xác nhận action đã trigger
  - Mỗi hàm có timeout configurable và trả về success/error result
  - _Requirements: 3_
  - _Contracts: IFlowAutomator, IAutomationCommand_

- [x] 4.2 Implement completion detection
  - MutationObserver theo dõi result container cho DOM changes
  - Detect trạng thái: generating (loading indicator present), completed (video element appears), error (error message appears)
  - Timeout safety (default 120s) — nếu quá timeout thì báo lỗi
  - Emit kết quả về Service Worker qua message passing
  - _Requirements: 3_

- [x] 4.3 Implement frame extractor
  - Tìm video element trong result container qua selector
  - Seek video tới cuối (`video.currentTime = video.duration`)
  - Listen sự kiện `seeked`, sau đó vẽ frame lên offscreen canvas (`drawImage`)
  - Export canvas thành base64 PNG (`toDataURL`)
  - Timeout 10s cho toàn bộ quá trình extract
  - Trả về image data URL, width, height hoặc error
  - _Requirements: 4_
  - _Contracts: IFrameExtractor_

---

- [x] 5. Xây dựng batch orchestrator và quản lý state (Service Worker)
- [x] 5.1 Implement state machine và batch execution loop
  - State machine với transitions: idle → running → paused → completed/cancelled
  - Khi START_BATCH: khởi tạo batch state, lưu vào storage, bắt đầu loop
  - Execution loop: lấy prompt hiện tại → gửi EXECUTE_COMMAND tới content script → chờ kết quả → xử lý → next
  - Chain logic: lấy frame từ video trước → dùng làm first frame cho video tiếp
  - Persist state vào chrome.storage.local sau mỗi transition
  - Thiết lập chrome.alarms để keep service worker alive trong khi batch running
  - Gửi PROGRESS_UPDATE tới Side Panel sau mỗi prompt hoàn thành
  - Gửi BATCH_COMPLETE với summary khi hết danh sách
  - Side Panel hiển thị thanh progress tổng thể, trạng thái video hiện tại, nút Pause/Resume/Cancel
  - _Requirements: 3, 4, 5_
  - _Contracts: IBatchOrchestrator, IBatchState_

- [x] 5.2 Implement batch controls (Pause/Resume/Cancel)
  - Pause: đặt flag, dừng sau khi video hiện tại hoàn thành, giữ state
  - Resume: load state từ storage, tiếp tục từ prompt tiếp theo
  - Cancel: dừng ngay, đánh dấu prompt còn lại là pending, clear alarm
  - Thông báo tổng kết khi batch hoàn thành (số thành công, số lỗi)
  - _Requirements: 5_

- [x] 5.3 (P) Implement history manager
  - Lưu batch record khi batch hoàn thành: danh sách prompt + status, config, thời gian, frame data
  - Tab "History" trong Side Panel hiển thị danh sách batch gần đây với summary
  - Cho phép xem chi tiết từng batch (expand prompt list)
  - Cho phép xóa batch record riêng lẻ hoặc clear all
  - Hiển thị storage usage và auto-cleanup records > 30 ngày khi storage > 8MB
  - _Requirements: 6_
  - _Contracts: IHistoryManager, IBatchRecord_

---

- [x] 6. Xử lý lỗi, recovery, và integration test
- [x] 6.1 Implement error handling và retry logic
  - Retry khi DOM element not found hoặc video generate fail: tối đa 3 lần, delay tăng dần (2s, 4s, 8s)
  - Sau 3 lần retry thất bại: đánh dấu prompt là "error", chuyển sang prompt tiếp
  - Khi prompt lỗi: dùng last successful frame cho video tiếp theo; nếu không có (video đầu lỗi) → dùng first frame config hoặc chạy text-to-video
  - Detect page reload/navigate away qua content script disconnect event → thông báo user
  - Ghi error log chi tiết (timestamp, batchId, promptId, category, message, context)
  - Limit error logs tối đa 500 entries, auto-cleanup cũ nhất
  - _Requirements: 7_
  - _Contracts: IRetryPolicy, IErrorLog_

- [x] 6.2 Service Worker recovery
  - Khi Service Worker restart (bị terminate rồi wake lại): đọc batch state từ storage
  - Nếu batch đang ở status "running": tự động resume từ prompt hiện tại
  - Nếu batch đang ở status "paused": giữ nguyên, chờ user resume
  - Test scenario: simulate SW terminate → verify state persistence → verify resume
  - _Requirements: 7_

---

- [ ] 7. Integration end-to-end và polish
- [ ] 7.1 Kết nối toàn bộ flow end-to-end
  - Verify full flow: nhập prompts → configure → start → automate Google Flow → extract frames → chain → complete
  - Verify tất cả message passing hoạt động đúng giữa 3 layers
  - Verify state persistence qua các lần mở/đóng Side Panel
  - Verify connection status tự động cập nhật khi chuyển tab
  - _Requirements: 1, 2, 3, 4, 5, 8_

- [ ] 7.2 UI polish và edge cases
  - Visual feedback rõ ràng: màu sắc cho status (xanh=done, vàng=running, đỏ=error, xám=pending)
  - Micro-animations cho progress updates và state transitions
  - Empty states cho prompt list và history
  - Validation: block start khi prompt list rỗng, khi không connected Google Flow
  - Responsive layout cho side panel ở các width khác nhau
  - _Requirements: 8_
