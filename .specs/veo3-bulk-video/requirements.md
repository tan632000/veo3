# Requirements Document

## Project Description (Input)
Chrome extension dùng local để bulk tạo video bằng Veo3. Khi hoàn thành video đầu tiên, tự động lấy frame cuối cùng làm input cho video tiếp theo, tạo chuỗi video liên tục.

## Introduction
Đây là dự án greenfield — xây dựng Chrome Extension hoạt động trên giao diện Google Flow (Veo3) để tự động hóa quy trình tạo video hàng loạt. Extension sẽ inject script vào trang Google Flow, tương tác với DOM để điều khiển workflow: nhập prompt, upload image, theo dõi trạng thái generate, trích xuất frame cuối cùng, và tự động chain sang video tiếp theo.

**Bối cảnh Veo3/Google Flow:**
- Veo3 hỗ trợ chế độ "Frames to Video" — cho phép dùng image làm first frame
- Video được generate dưới dạng clip 4-8 giây
- Giao diện web tại Google Flow cho phép upload image, nhập prompt, chọn model, và download kết quả

---

## Requirements

### Requirement 1: Quản lý danh sách Prompt hàng loạt
**Objective:** As a người dùng, I want nhập danh sách nhiều prompt video cùng lúc, so that tôi có thể lên kế hoạch cho chuỗi video liên tục mà không cần thao tác thủ công từng cái.

#### Acceptance Criteria
1. The Extension shall hiển thị popup/side panel với giao diện nhập danh sách prompt.
2. When người dùng nhập nhiều prompt (mỗi dòng một prompt), the Extension shall phân tách và lưu thành danh sách có thứ tự.
3. The Extension shall cho phép người dùng thêm, sửa, xóa, và sắp xếp lại thứ tự các prompt trong danh sách.
4. The Extension shall hiển thị số lượng prompt trong danh sách và trạng thái từng prompt (chờ xử lý / đang tạo / hoàn thành / lỗi).
5. The Extension shall lưu danh sách prompt vào local storage để không mất dữ liệu khi đóng popup.

---

### Requirement 2: Cấu hình ban đầu cho chuỗi video
**Objective:** As a người dùng, I want cấu hình image đầu tiên và các tùy chọn generate, so that chuỗi video bắt đầu đúng với hình ảnh mong muốn và chất lượng phù hợp.

#### Acceptance Criteria
1. The Extension shall cho phép người dùng upload một image làm first frame cho video đầu tiên trong chuỗi.
2. Where image đầu tiên không được cung cấp, the Extension shall cho phép bắt đầu chuỗi chỉ với prompt (text-to-video cho video đầu).
3. The Extension shall cho phép người dùng chọn cấu hình generate: aspect ratio (16:9 hoặc 9:16).
4. The Extension shall lưu cấu hình vào local storage và tự động áp dụng cho toàn bộ chuỗi.

---

### Requirement 3: Tự động thực thi tạo video trên Google Flow
**Objective:** As a người dùng, I want extension tự động điều khiển giao diện Google Flow để tạo video, so that tôi không cần thao tác thủ công trên trang web.

#### Acceptance Criteria
1. When người dùng nhấn nút "Bắt đầu" và đang ở trang Google Flow, the Extension shall tự động chọn chế độ "Frames to Video" trên giao diện.
2. When bắt đầu video đầu tiên có image, the Extension shall tự động upload image đã cấu hình làm first frame.
3. The Extension shall tự động điền prompt tương ứng vào ô nhập prompt trên Google Flow.
4. The Extension shall tự động nhấn nút Generate để bắt đầu tạo video.
5. While video đang được generate, the Extension shall theo dõi trạng thái (polling DOM) và cập nhật progress trên giao diện Extension.
6. If Google Flow hiển thị lỗi trong quá trình generate, the Extension shall ghi nhận lỗi, cập nhật trạng thái prompt thành "lỗi", và tự động thử lại hoặc chuyển sang prompt tiếp theo tùy cấu hình.

---

### Requirement 4: Trích xuất frame cuối cùng và chain video
**Objective:** As a người dùng, I want extension tự động lấy frame cuối cùng của video vừa tạo xong, so that frame đó được dùng làm first frame cho video tiếp theo trong chuỗi.

#### Acceptance Criteria
1. When video được generate thành công, the Extension shall phát hiện video hoàn thành thông qua theo dõi DOM.
2. When video hoàn thành, the Extension shall trích xuất frame cuối cùng từ video result (qua canvas capture từ video element hoặc download video rồi extract frame).
3. The Extension shall lưu frame cuối cùng dưới dạng image (PNG/JPEG) vào bộ nhớ tạm.
4. When chuyển sang prompt tiếp theo, the Extension shall tự động upload frame cuối cùng vừa trích xuất làm first frame cho video mới.
5. The Extension shall lặp lại quy trình (Requirement 3 + 4) cho đến khi hết danh sách prompt.

---

### Requirement 5: Theo dõi tiến trình và điều khiển batch
**Objective:** As a người dùng, I want theo dõi tiến trình tổng thể và can thiệp khi cần, so that tôi kiểm soát được quá trình tạo video hàng loạt.

#### Acceptance Criteria
1. While batch đang chạy, the Extension shall hiển thị thanh progress tổng thể (ví dụ: "3/10 videos hoàn thành").
2. While batch đang chạy, the Extension shall hiển thị trạng thái chi tiết của video đang xử lý hiện tại.
3. The Extension shall cho phép người dùng tạm dừng (Pause) batch — dừng sau khi video hiện tại hoàn thành.
4. When batch bị tạm dừng, the Extension shall cho phép tiếp tục (Resume) từ prompt tiếp theo trong danh sách.
5. The Extension shall cho phép người dùng hủy (Cancel) batch — dừng ngay lập tức và đánh dấu các prompt còn lại là "chờ xử lý".
6. When toàn bộ batch hoàn thành, the Extension shall hiển thị thông báo tổng kết (số video thành công, số lỗi).

---

### Requirement 6: Lưu trữ kết quả và lịch sử
**Objective:** As a người dùng, I want xem lại lịch sử các batch đã chạy, so that tôi có thể theo dõi và quản lý công việc.

#### Acceptance Criteria
1. The Extension shall lưu lịch sử mỗi batch đã chạy bao gồm: danh sách prompt, trạng thái từng prompt, thời gian bắt đầu/kết thúc.
2. The Extension shall lưu các frame cuối cùng đã trích xuất được liên kết với prompt tương ứng.
3. When người dùng mở lịch sử, the Extension shall hiển thị danh sách các batch gần đây với thông tin tóm tắt.
4. The Extension shall cho phép người dùng xóa lịch sử batch cũ để giải phóng dung lượng.

---

### Requirement 7: Xử lý lỗi và tự phục hồi
**Objective:** As a người dùng, I want extension xử lý các tình huống lỗi một cách thông minh, so that quá trình batch không bị gián đoạn hoàn toàn khi gặp sự cố.

#### Acceptance Criteria
1. If Google Flow không phản hồi hoặc DOM thay đổi không mong muốn, the Extension shall retry thao tác tối đa 3 lần với delay tăng dần.
2. If video generate thất bại sau khi retry, the Extension shall đánh dấu prompt đó là "lỗi" và tự động chuyển sang prompt tiếp theo.
3. If trang Google Flow bị reload hoặc navigate away, the Extension shall phát hiện và thông báo cho người dùng.
4. The Extension shall ghi log chi tiết mọi lỗi xảy ra để người dùng có thể debug.
5. If prompt bị lỗi, the Extension shall sử dụng frame cuối cùng thành công gần nhất cho video tiếp theo (không bỏ qua chain).

---

### Requirement 8: Giao diện Extension (Popup/Side Panel)
**Objective:** As a người dùng, I want giao diện Extension trực quan và dễ sử dụng, so that tôi có thể thao tác nhanh chóng.

#### Acceptance Criteria
1. The Extension shall có giao diện popup hoặc side panel với các tab/section rõ ràng: Nhập prompt, Cấu hình, Tiến trình, Lịch sử.
2. The Extension shall hiển thị trạng thái kết nối với trang Google Flow (đang mở / chưa mở / không khả dụng).
3. The Extension shall chỉ kích hoạt các chức năng automation khi phát hiện đang ở trang Google Flow.
4. The Extension shall có thiết kế responsive, hỗ trợ cả popup nhỏ gọn và side panel mở rộng.
5. The Extension shall sử dụng visual feedback rõ ràng (màu sắc, icon, animation) cho các trạng thái khác nhau.
