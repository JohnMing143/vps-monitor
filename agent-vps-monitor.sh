#!/bin/bash
# VPS Monitoring Script - Enhanced Edition Installer

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # 无颜色

# --- 语言字符串 ---
# 中文 (zh)
BANNER_TITLE_ZH="VPS监控系统 - 客户端管理工具"
BANNER_FEATURES_ZH="功能: 监控CPU、内存、硬盘和网络使用情况"
BANNER_VERSION_ZH="版本: 1.0.0"
ERROR_ROOT_ZH="错误: 此脚本需要root权限"
CHECKING_DEPS_ZH="正在检查并安装依赖..."
ERROR_UNSUPPORTED_OS_ZH="不支持的系统，无法自动安装依赖"
DEPS_INSTALLED_ZH="依赖安装完成"
CREATING_SCRIPT_ZH="正在创建监控脚本..."
SCRIPT_CREATED_ZH="监控脚本创建完成"
CREATING_SERVICE_ZH="正在创建系统服务..."
SERVICE_CREATED_ZH="系统服务创建完成"
INSTALL_START_ZH="开始安装VPS监控系统..."
ALREADY_INSTALLED_ZH="监控系统已经安装并运行中。"
REINSTALL_PROMPT_ZH="如需重新安装，请先卸载现有安装。"
CONFIG_PROMPT_ZH="请输入监控系统配置信息:"
API_KEY_PROMPT_ZH="API密钥: "
API_KEY_EMPTY_ZH="API密钥不能为空"
SERVER_ID_PROMPT_ZH="服务器ID: "
SERVER_ID_EMPTY_ZH="服务器ID不能为空"
WORKER_URL_PROMPT_ZH="Worker URL (例如: https://example.workers.dev): "
WORKER_URL_EMPTY_ZH="Worker URL不能为空"
INSTALL_DEPS_FAILED_ZH="安装依赖失败，请手动安装bc、curl和ifstat"
STARTING_SERVICE_ZH="正在启动监控服务..."
INSTALL_COMPLETE_ZH="VPS监控系统安装完成！"
SERVICE_STATUS_ZH="服务状态: "
VIEW_STATUS_CMD_ZH="查看服务状态: systemctl status "
VIEW_LOG_CMD_ZH="查看服务日志: journalctl -u "
VIEW_LOG_CMD_ALT_ZH="或: tail -f /var/log/vps-monitor.log"
UNINSTALL_START_ZH="开始卸载VPS监控系统..."
NOT_INSTALLED_ZH="监控系统未安装。"
CONFIRM_UNINSTALL_ZH="确定要卸载VPS监控系统吗？(y/n): "
UNINSTALL_CANCELLED_ZH="卸载已取消。"
STOPPING_SERVICE_ZH="正在停止监控服务..."
DELETING_SERVICE_ZH="正在删除系统服务..."
DELETING_FILES_ZH="正在删除安装文件..."
UNINSTALL_COMPLETE_ZH="VPS监控系统已成功卸载！"
STATUS_TITLE_ZH="VPS监控系统状态:"
SERVICE_RUNNING_ZH="● 监控服务运行中"
SERVICE_NOT_RUNNING_ZH="● 监控服务未运行"
ENABLED_ON_BOOT_ZH="● 已设置开机自启"
NOT_ENABLED_ON_BOOT_ZH="● 未设置开机自启"
CONFIG_INFO_ZH="配置信息:"
SERVER_ID_LABEL_ZH="  服务器ID: "
WORKER_URL_LABEL_ZH="  Worker URL: "
INSTALL_DIR_LABEL_ZH="  安装目录: "
CONFIG_NOT_FOUND_ZH="● 配置文件不存在"
SYSTEM_INFO_ZH="系统信息:"
CPU_USAGE_LABEL_ZH="  CPU使用率: "
MEM_USAGE_LABEL_ZH="  内存使用率: "
DISK_USAGE_LABEL_ZH="  硬盘使用率: "
RECENT_LOGS_ZH="最近日志:"
SERVICE_CONTROL_CMDS_ZH="服务控制命令:"
START_SERVICE_CMD_ZH="  启动服务: "
STOP_SERVICE_CMD_ZH="  停止服务: "
RESTART_SERVICE_CMD_ZH="  重启服务: "
SERVICE_STOPPED_ZH="服务已停止"
SERVICE_WAS_NOT_RUNNING_ZH="服务未运行"
LOG_TITLE_ZH="VPS监控系统日志:"
LOG_PROMPT_ZH="显示最近50行日志，按Ctrl+C退出"
LOG_FILE_NOT_FOUND_ZH="日志文件不存在"
TRY_SYSTEM_LOG_ZH="尝试查看系统日志:"
SERVICE_RESTARTED_ZH="服务已重启"
SERVICE_STARTED_ZH="服务已启动"
MODIFY_CONFIG_TITLE_ZH="修改VPS监控系统配置:"
MODIFY_PROMPT_ZH="直接输入新值，留空则保留当前值。"
ERROR_LOAD_CONFIG_ZH="错误: 无法加载配置文件 "
NEW_API_KEY_PROMPT_ZH="新的API密钥 [当前: "
NEW_SERVER_ID_PROMPT_ZH="新的服务器ID [当前: "
NEW_WORKER_URL_PROMPT_ZH="新的Worker URL [当前: "
SAVING_CONFIG_ZH="正在保存配置..."
UPDATING_SCRIPT_ZH="正在更新监控脚本..."
RESTARTING_SERVICE_APPLY_CONFIG_ZH="正在重启服务以应用新配置..."
CONFIG_SAVED_RESTARTED_ZH="配置已保存并重启服务。"
MENU_SELECT_ACTION_ZH="请选择操作:"
MENU_ITEM_1_ZH=" 安装监控系统"
MENU_ITEM_2_ZH=" 卸载监控系统"
MENU_ITEM_3_ZH=" 查看监控状态"
MENU_ITEM_4_ZH=" 查看监控日志"
MENU_ITEM_5_ZH=" 停止监控服务"
MENU_ITEM_6_ZH=" 重启监控服务"
MENU_ITEM_7_ZH=" 修改配置"
MENU_ITEM_0_ZH=" 退出"
MENU_PROMPT_ZH="请输入选项 [0-7]: "
INVALID_CHOICE_ZH="无效的选择，请重试"
PRESS_ENTER_ZH="按Enter键继续..."
UNKNOWN_PARAM_ZH="未知参数: "
HELP_USAGE_ZH="用法: "
HELP_OPTIONS_ZH="选项:"
HELP_API_KEY_ZH="  -k, --key KEY        API密钥"
HELP_SERVER_ID_ZH="  -s, --server ID      服务器ID"
HELP_WORKER_URL_ZH="  -u, --url URL        Worker URL"
HELP_INSTALL_DIR_ZH="  -d, --dir DIR        安装目录 (默认: /opt/vps-monitor)"
HELP_DIRECT_INSTALL_ZH="  -i, --install        直接安装，不显示菜单"
HELP_LANGUAGE_ZH="  -l, --lang LANG      设置语言 (en/zh, 默认: en)"
HELP_HELP_ZH="  -h, --help           显示此帮助信息"
HELP_EXAMPLE_ZH="示例:"
HELP_EXAMPLE_MENU_ZH="                       显示交互式菜单"
HELP_EXAMPLE_DIRECT_ZH="                       直接安装监控系统"
LANGUAGE_PROMPT_ZH="请选择语言 (Please select language):"
LANGUAGE_1_ZH="1. English"
LANGUAGE_2_ZH="2. 中文"
INVALID_LANG_CHOICE_ZH="无效选择，将使用英文 (Invalid choice, defaulting to English)."


# 英文 (en)
BANNER_TITLE_EN="VPS Monitoring System - Client Management Tool"
BANNER_FEATURES_EN="Features: Monitor CPU, Memory, Disk, and Network usage"
BANNER_VERSION_EN="Version: 1.0.0"
ERROR_ROOT_EN="Error: This script requires root privileges"
CHECKING_DEPS_EN="Checking and installing dependencies..."
ERROR_UNSUPPORTED_OS_EN="Unsupported OS, cannot install dependencies automatically"
DEPS_INSTALLED_EN="Dependencies installed successfully"
CREATING_SCRIPT_EN="Creating monitoring script..."
SCRIPT_CREATED_EN="Monitoring script created successfully"
CREATING_SERVICE_EN="Creating system service..."
SERVICE_CREATED_EN="System service created successfully"
INSTALL_START_EN="Starting VPS Monitoring System installation..."
ALREADY_INSTALLED_EN="Monitoring system is already installed and running."
REINSTALL_PROMPT_EN="To reinstall, please uninstall the current installation first."
CONFIG_PROMPT_EN="Please enter monitoring system configuration:"
API_KEY_PROMPT_EN="API Key: "
API_KEY_EMPTY_EN="API Key cannot be empty"
SERVER_ID_PROMPT_EN="Server ID: "
SERVER_ID_EMPTY_EN="Server ID cannot be empty"
WORKER_URL_PROMPT_EN="Worker URL (e.g., https://example.workers.dev): "
WORKER_URL_EMPTY_EN="Worker URL cannot be empty"
INSTALL_DEPS_FAILED_EN="Failed to install dependencies. Please install bc, curl, and ifstat manually"
STARTING_SERVICE_EN="Starting monitoring service..."
INSTALL_COMPLETE_EN="VPS Monitoring System installed successfully!"
SERVICE_STATUS_EN="Service Status: "
VIEW_STATUS_CMD_EN="View service status: systemctl status "
VIEW_LOG_CMD_EN="View service logs: journalctl -u "
VIEW_LOG_CMD_ALT_EN="Or: tail -f /var/log/vps-monitor.log"
UNINSTALL_START_EN="Starting VPS Monitoring System uninstallation..."
NOT_INSTALLED_EN="Monitoring system is not installed."
CONFIRM_UNINSTALL_EN="Are you sure you want to uninstall the VPS Monitoring System? (y/n): "
UNINSTALL_CANCELLED_EN="Uninstallation cancelled."
STOPPING_SERVICE_EN="Stopping monitoring service..."
DELETING_SERVICE_EN="Deleting system service..."
DELETING_FILES_EN="Deleting installation files..."
UNINSTALL_COMPLETE_EN="VPS Monitoring System uninstalled successfully!"
STATUS_TITLE_EN="VPS Monitoring System Status:"
SERVICE_RUNNING_EN="● Monitoring service is running"
SERVICE_NOT_RUNNING_EN="● Monitoring service is not running"
ENABLED_ON_BOOT_EN="● Enabled on boot"
NOT_ENABLED_ON_BOOT_EN="● Not enabled on boot"
CONFIG_INFO_EN="Configuration Information:"
SERVER_ID_LABEL_EN="  Server ID: "
WORKER_URL_LABEL_EN="  Worker URL: "
INSTALL_DIR_LABEL_EN="  Installation Directory: "
CONFIG_NOT_FOUND_EN="● Configuration file not found"
SYSTEM_INFO_EN="System Information:"
CPU_USAGE_LABEL_EN="  CPU Usage: "
MEM_USAGE_LABEL_EN="  Memory Usage: "
DISK_USAGE_LABEL_EN="  Disk Usage: "
RECENT_LOGS_EN="Recent Logs:"
SERVICE_CONTROL_CMDS_EN="Service Control Commands:"
START_SERVICE_CMD_EN="  Start service: "
STOP_SERVICE_CMD_EN="  Stop service: "
RESTART_SERVICE_CMD_EN="  Restart service: "
SERVICE_STOPPED_EN="Service stopped"
SERVICE_WAS_NOT_RUNNING_EN="Service was not running"
LOG_TITLE_EN="VPS Monitoring System Logs:"
LOG_PROMPT_EN="Displaying last 50 log lines. Press Ctrl+C to exit"
LOG_FILE_NOT_FOUND_EN="Log file not found"
TRY_SYSTEM_LOG_EN="Attempting to view system logs:"
SERVICE_RESTARTED_EN="Service restarted"
SERVICE_STARTED_EN="Service started"
MODIFY_CONFIG_TITLE_EN="Modify VPS Monitoring System Configuration:"
MODIFY_PROMPT_EN="Enter new value directly. Leave blank to keep current value."
ERROR_LOAD_CONFIG_EN="Error: Cannot load configuration file "
NEW_API_KEY_PROMPT_EN="New API Key [Current: "
NEW_SERVER_ID_PROMPT_EN="New Server ID [Current: "
NEW_WORKER_URL_PROMPT_EN="New Worker URL [Current: "
SAVING_CONFIG_EN="Saving configuration..."
UPDATING_SCRIPT_EN="Updating monitoring script..."
RESTARTING_SERVICE_APPLY_CONFIG_EN="Restarting service to apply new configuration..."
CONFIG_SAVED_RESTARTED_EN="Configuration saved and service restarted."
MENU_SELECT_ACTION_EN="Please select an action:"
MENU_ITEM_1_EN=" Install Monitoring System"
MENU_ITEM_2_EN=" Uninstall Monitoring System"
MENU_ITEM_3_EN=" Check Monitoring Status"
MENU_ITEM_4_EN=" View Monitoring Logs"
MENU_ITEM_5_EN=" Stop Monitoring Service"
MENU_ITEM_6_EN=" Restart Monitoring Service"
MENU_ITEM_7_EN=" Modify Configuration"
MENU_ITEM_0_EN=" Exit"
MENU_PROMPT_EN="Enter option [0-7]: "
INVALID_CHOICE_EN="Invalid choice, please try again"
PRESS_ENTER_EN="Press Enter to continue..."
UNKNOWN_PARAM_EN="Unknown parameter: "
HELP_USAGE_EN="Usage: "
HELP_OPTIONS_EN="Options:"
HELP_API_KEY_EN="  -k, --key KEY        API Key"
HELP_SERVER_ID_EN="  -s, --server ID      Server ID"
HELP_WORKER_URL_EN="  -u, --url URL        Worker URL"
HELP_INSTALL_DIR_EN="  -d, --dir DIR        Installation directory (default: /opt/vps-monitor)"
HELP_DIRECT_INSTALL_EN="  -i, --install        Direct install, skip menu"
HELP_LANGUAGE_EN="  -l, --lang LANG      Set language (en/zh, default: en)"
HELP_HELP_EN="  -h, --help           Show this help information"
HELP_EXAMPLE_EN="Examples:"
HELP_EXAMPLE_MENU_EN="                       Show interactive menu"
HELP_EXAMPLE_DIRECT_EN="                       Directly install monitoring system"
LANGUAGE_PROMPT_EN="Please select language:"
LANGUAGE_1_EN="1. English"
LANGUAGE_2_EN="2. 中文"
INVALID_LANG_CHOICE_EN="Invalid choice, defaulting to English."

# --- End Language Strings ---

# 默认配置
API_KEY=""
SERVER_ID=""
WORKER_URL=""
INSTALL_DIR="/opt/vps-monitor"
SERVICE_NAME="vps-monitor"
CONFIG_FILE="$INSTALL_DIR/config.conf"
CURRENT_LANG="en" # 默认语言

# 获取翻译后的字符串
t() {
    local key="$1"
    local lang_prefix="${CURRENT_LANG^^}" # EN or ZH
    local var_name="${key}_${lang_prefix}"
    echo -e "${!var_name}" # Indirect expansion
}

# 选择语言
select_language() {
    if [ -n "$ARG_LANG" ]; then # 如果通过参数指定了语言
        if [ "$ARG_LANG" = "zh" ] || [ "$ARG_LANG" = "en" ]; then
            CURRENT_LANG="$ARG_LANG"
            return
        fi
    fi

    echo -e "${BLUE}$(t LANGUAGE_PROMPT)${NC}"
    echo -e "  ${GREEN}$(t LANGUAGE_1)${NC}"
    echo -e "  ${GREEN}$(t LANGUAGE_2)${NC}"
    read -p "Enter your choice (1/2): " lang_choice

    case $lang_choice in
        1) CURRENT_LANG="en" ;;
        2) CURRENT_LANG="zh" ;;
        *) 
           echo -e "${RED}$(t INVALID_LANG_CHOICE)${NC}"
           CURRENT_LANG="en" # 默认英文
           ;;
    esac
    echo "" # Newline for better formatting
}


# 显示横幅
show_banner() {
    clear
    echo -e "${BLUE}┌─────────────────────────────────────────────┐${NC}"
    echo -e "${BLUE}│       ${GREEN}$(t BANNER_TITLE)${BLUE}         │${NC}"
    echo -e "${BLUE}│                                             │${NC}"
    echo -e "${BLUE}│  ${YELLOW}$(t BANNER_FEATURES)${BLUE}    │${NC}"
    echo -e "${BLUE}│  ${YELLOW}$(t BANNER_VERSION)${BLUE}   │${NC}"
    echo -e "${BLUE}└─────────────────────────────────────────────┘${NC}"
    echo ""
}

# 检查是否为root用户
check_root() {
    if [ "$(id -u)" -ne 0 ]; then
        echo -e "${RED}$(t ERROR_ROOT)${NC}"
        exit 1
    fi
}

# 加载配置
load_config() {
    if [ -f "$CONFIG_FILE" ]; then
        source "$CONFIG_FILE"
        return 0
    fi
    return 1
}

# 保存配置
save_config() {
    mkdir -p "$INSTALL_DIR"
    cat > "$CONFIG_FILE" << EOF
# VPS监控系统配置文件
API_KEY="$API_KEY"
SERVER_ID="$SERVER_ID"
WORKER_URL="$WORKER_URL"
INSTALL_DIR="$INSTALL_DIR"
SERVICE_NAME="$SERVICE_NAME"
EOF
    chmod 600 "$CONFIG_FILE"
}

# 安装依赖
install_dependencies() {
    echo -e "${YELLOW}$(t CHECKING_DEPS)${NC}"
    
    if command -v apt-get &> /dev/null; then
        PKG_MANAGER="apt-get"
    elif command -v yum &> /dev/null; then
        PKG_MANAGER="yum"
    else
        echo -e "${RED}$(t ERROR_UNSUPPORTED_OS)${NC}"
        return 1
    fi
    
    $PKG_MANAGER update -y >/dev/null 2>&1
    $PKG_MANAGER install -y bc curl ifstat jq >/dev/null 2>&1
    
    echo -e "${GREEN}$(t DEPS_INSTALLED)${NC}"
    return 0
}

# 创建监控脚本
create_monitor_script() {
    echo -e "${YELLOW}$(t CREATING_SCRIPT)${NC}"
    
    cat > "$INSTALL_DIR/monitor.sh" << 'EOF'
#!/bin/bash

# 配置
API_KEY="__API_KEY__"
SERVER_ID="__SERVER_ID__"
WORKER_URL="__WORKER_URL__"
INTERVAL=60  # 上报间隔（秒）
LOG_FILE="/var/log/vps-monitor.log"

# 日志函数
log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "$LOG_FILE"
}

# 获取CPU使用率
get_cpu_usage() {
  cpu_usage=$(top -bn1 | grep "Cpu(s)" | sed "s/.*, *\\([0-9.]*\\)%* id.*/\\1/" | awk '{print 100 - $1}')
  cpu_load=$(cat /proc/loadavg | awk '{print $1","$2","$3}')
  echo "{\"usage_percent\":$cpu_usage,\"load_avg\":[$cpu_load]}"
}

# 获取内存使用情况
get_memory_usage() {
  total=$(free -k | grep Mem | awk '{print $2}')
  used=$(free -k | grep Mem | awk '{print $3}')
  free=$(free -k | grep Mem | awk '{print $4}')
  usage_percent=$(echo "scale=1; $used * 100 / $total" | bc)
  echo "{\"total\":$total,\"used\":$used,\"free\":$free,\"usage_percent\":$usage_percent}"
}

# 获取硬盘使用情况
get_disk_usage() {
  disk_info=$(df -k / | tail -1)
  total=$(echo "$disk_info" | awk '{print $2 / 1024 / 1024}') # GB
  used=$(echo "$disk_info" | awk '{print $3 / 1024 / 1024}') # GB
  free=$(echo "$disk_info" | awk '{print $4 / 1024 / 1024}') # GB
  usage_percent=$(echo "$disk_info" | awk '{print $5}' | tr -d '%')
  echo "{\"total\":$total,\"used\":$used,\"free\":$free,\"usage_percent\":$usage_percent}"
}

# 获取网络使用情况
get_network_usage() {
    if ! command -v ifstat &> /dev/null; then
        log "ifstat is not installed. Cannot get network speed."
        echo "{\"upload_speed\":0,\"download_speed\":0,\"total_upload\":0,\"total_download\":0}"
        return
    fi
    
    interface=$(ip route | grep default | awk '{print $5}' | head -n 1)
    if [ -z "$interface" ]; then
        log "Could not determine default network interface."
        interface=$(ip -o link show | awk -F': ' '{print $2}' | grep -E '^(eth|enp|ens|eno|wlan|wlp)' | head -n 1) # Fallback
        if [ -z "$interface" ]; then
          log "Fallback interface detection also failed."
          echo "{\"upload_speed\":0,\"download_speed\":0,\"total_upload\":0,\"total_download\":0}"
          return
        fi
        log "Using fallback interface: $interface"
    fi
    
    network_speed_kbps=$(ifstat -i "$interface" -t 1 1 | tail -n 1) # -t for summary in KB/s
    download_speed_bytes=$(echo "$network_speed_kbps" | awk '{print $1 * 1024}')
    upload_speed_bytes=$(echo "$network_speed_kbps" | awk '{print $2 * 1024}')
    
    rx_bytes=$(cat "/sys/class/net/$interface/statistics/rx_bytes")
    tx_bytes=$(cat "/sys/class/net/$interface/statistics/tx_bytes")
    
    echo "{\"upload_speed\":$upload_speed_bytes,\"download_speed\":$download_speed_bytes,\"total_upload\":$tx_bytes,\"total_download\":$rx_bytes}"
}


# 上报数据
report_metrics() {
    timestamp=$(date +%s)
    cpu=$(get_cpu_usage)
    memory=$(get_memory_usage)
    disk=$(get_disk_usage)
    network=$(get_network_usage)
    
    data="{\"timestamp\":$timestamp,\"cpu\":$cpu,\"memory\":$memory,\"disk\":$disk,\"network\":$network}"
    
    log "Reporting data..."
    
    response=$(curl -s -X POST "$WORKER_URL/api/report/$SERVER_ID" \
        -H "Content-Type: application/json" \
        -H "X-API-Key: $API_KEY" \
        -d "$data")
    
    if [[ "$response" == *"success"* ]]; then
        log "Data reported successfully"
    else
        log "Data reporting failed: $response"
    fi
}

# 主函数
main() {
    log "VPS Monitoring Script started"
    log "Server ID: $SERVER_ID"
    log "Worker URL: $WORKER_URL"
    
    touch "$LOG_FILE" # Ensure log file exists
    
    while true; do
        report_metrics
        sleep $INTERVAL
    done
}

main
EOF

    sed -i "s|__API_KEY__|$API_KEY|g" "$INSTALL_DIR/monitor.sh"
    sed -i "s|__SERVER_ID__|$SERVER_ID|g" "$INSTALL_DIR/monitor.sh"
    sed -i "s|__WORKER_URL__|$WORKER_URL|g" "$INSTALL_DIR/monitor.sh"
    chmod +x "$INSTALL_DIR/monitor.sh"
    
    echo -e "${GREEN}$(t SCRIPT_CREATED)${NC}"
}

# 创建systemd服务
create_service() {
    echo -e "${YELLOW}$(t CREATING_SERVICE)${NC}"
    
    cat > "/etc/systemd/system/$SERVICE_NAME.service" << EOF
[Unit]
Description=VPS Monitor Service
After=network.target

[Service]
ExecStart=$INSTALL_DIR/monitor.sh
Restart=always
User=root
Group=root
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    echo -e "${GREEN}$(t SERVICE_CREATED)${NC}"
}

# 安装监控系统
install_monitor() {
    show_banner
    echo -e "${CYAN}$(t INSTALL_START)${NC}"
    
    if systemctl is-active --quiet $SERVICE_NAME; then
        echo -e "${YELLOW}$(t ALREADY_INSTALLED)${NC}"
        echo -e "${YELLOW}$(t REINSTALL_PROMPT)${NC}"
        return
    fi
    
    if [ -z "$API_KEY" ] || [ -z "$SERVER_ID" ] || [ -z "$WORKER_URL" ]; then
        echo -e "${CYAN}$(t CONFIG_PROMPT)${NC}"
        
        while [ -z "$API_KEY" ]; do
            read -p "$(t API_KEY_PROMPT)" API_KEY
            if [ -z "$API_KEY" ]; then echo -e "${RED}$(t API_KEY_EMPTY)${NC}"; fi
        done
        
        while [ -z "$SERVER_ID" ]; do
            read -p "$(t SERVER_ID_PROMPT)" SERVER_ID
            if [ -z "$SERVER_ID" ]; then echo -e "${RED}$(t SERVER_ID_EMPTY)${NC}"; fi
        done
        
        while [ -z "$WORKER_URL" ]; do
            read -p "$(t WORKER_URL_PROMPT)" WORKER_URL
            if [ -z "$WORKER_URL" ]; then echo -e "${RED}$(t WORKER_URL_EMPTY)${NC}"; fi
        done
    else
         echo -e "${GREEN}Using provided API_KEY, SERVER_ID, and WORKER_URL.${NC}"
    fi
    
    mkdir -p "$INSTALL_DIR"
    install_dependencies || { echo -e "${RED}$(t INSTALL_DEPS_FAILED)${NC}"; return 1; }
    create_monitor_script
    create_service
    save_config
    
    echo -e "${YELLOW}$(t STARTING_SERVICE)${NC}"
    systemctl enable "$SERVICE_NAME" >/dev/null 2>&1
    systemctl start "$SERVICE_NAME"
    
    echo -e "${GREEN}$(t INSTALL_COMPLETE)${NC}"
    echo -e "${CYAN}$(t SERVICE_STATUS)$(systemctl is-active $SERVICE_NAME)${NC}"
    echo -e "${CYAN}$(t VIEW_STATUS_CMD)$SERVICE_NAME${NC}"
    echo -e "${CYAN}$(t VIEW_LOG_CMD)$SERVICE_NAME -f${NC}"
    echo -e "${CYAN}$(t VIEW_LOG_CMD_ALT)${NC}"
}

# 卸载监控系统
uninstall_monitor() {
    show_banner
    echo -e "${CYAN}$(t UNINSTALL_START)${NC}"
    
    if ! systemctl is-active --quiet $SERVICE_NAME && [ ! -d "$INSTALL_DIR" ]; then
        echo -e "${YELLOW}$(t NOT_INSTALLED)${NC}"
        return
    fi
    
    read -p "$(t CONFIRM_UNINSTALL)" confirm
    if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
        echo -e "${YELLOW}$(t UNINSTALL_CANCELLED)${NC}"
        return
    fi
    
    echo -e "${YELLOW}$(t STOPPING_SERVICE)${NC}"
    systemctl stop "$SERVICE_NAME" 2>/dev/null
    systemctl disable "$SERVICE_NAME" 2>/dev/null
    
    echo -e "${YELLOW}$(t DELETING_SERVICE)${NC}"
    rm -f "/etc/systemd/system/$SERVICE_NAME.service"
    systemctl daemon-reload
    
    echo -e "${YELLOW}$(t DELETING_FILES)${NC}"
    rm -rf "$INSTALL_DIR"
    rm -f "/var/log/vps-monitor.log" # Also remove log file
    
    echo -e "${GREEN}$(t UNINSTALL_COMPLETE)${NC}"
}

# 查看监控状态
check_status() {
    show_banner
    echo -e "${CYAN}$(t STATUS_TITLE)${NC}"
    
    if systemctl is-active --quiet $SERVICE_NAME; then
        echo -e "${GREEN}$(t SERVICE_RUNNING)${NC}"
    else
        echo -e "${RED}$(t SERVICE_NOT_RUNNING)${NC}"
    fi
    
    if systemctl is-enabled --quiet $SERVICE_NAME; then
        echo -e "${GREEN}$(t ENABLED_ON_BOOT)${NC}"
    else
        echo -e "${RED}$(t NOT_ENABLED_ON_BOOT)${NC}"
    fi
    
    if load_config; then
        echo -e "${CYAN}$(t CONFIG_INFO)${NC}"
        echo -e "$(t SERVER_ID_LABEL)${YELLOW}$SERVER_ID${NC}"
        echo -e "$(t WORKER_URL_LABEL)${YELLOW}$WORKER_URL${NC}"
        echo -e "$(t INSTALL_DIR_LABEL)${YELLOW}$INSTALL_DIR${NC}"
    else
        echo -e "${RED}$(t CONFIG_NOT_FOUND)${NC}"
    fi
    
    echo -e "${CYAN}$(t SYSTEM_INFO)${NC}"
    cpu_usage_val=$(top -bn1 | grep "Cpu(s)" | sed "s/.*, *\\([0-9.]*\\)%* id.*/\\1/" | awk '{print 100 - $1}')
    mem_info_val=$(free -m | grep Mem)
    mem_total_val=$(echo "$mem_info_val" | awk '{print $2}')
    mem_used_val=$(echo "$mem_info_val" | awk '{print $3}')
    mem_usage_val=$(echo "scale=1; $mem_used_val * 100 / $mem_total_val" | bc)
    disk_usage_val=$(df -h / | tail -1 | awk '{print $5}')
    
    echo -e "$(t CPU_USAGE_LABEL)${YELLOW}${cpu_usage_val}%${NC}"
    echo -e "$(t MEM_USAGE_LABEL)${YELLOW}${mem_usage_val}% (${mem_used_val}MB/${mem_total_val}MB)${NC}"
    echo -e "$(t DISK_USAGE_LABEL)${YELLOW}${disk_usage_val}${NC}"
    
    if [ -f "/var/log/vps-monitor.log" ]; then
        echo -e "${CYAN}$(t RECENT_LOGS)${NC}"
        tail -n 5 "/var/log/vps-monitor.log"
    fi
    
    echo ""
    echo -e "${CYAN}$(t SERVICE_CONTROL_CMDS)${NC}"
    echo -e "$(t START_SERVICE_CMD)${YELLOW}systemctl start $SERVICE_NAME${NC}"
    echo -e "$(t STOP_SERVICE_CMD)${YELLOW}systemctl stop $SERVICE_NAME${NC}"
    echo -e "$(t RESTART_SERVICE_CMD)${YELLOW}systemctl restart $SERVICE_NAME${NC}"
}

# 停止监控服务
stop_service() {
    show_banner
    echo -e "${CYAN}$(t STOPPING_SERVICE)${NC}"
    if systemctl is-active --quiet $SERVICE_NAME; then
        systemctl stop "$SERVICE_NAME"
        echo -e "${GREEN}$(t SERVICE_STOPPED)${NC}"
    else
        echo -e "${YELLOW}$(t SERVICE_WAS_NOT_RUNNING)${NC}"
    fi
    echo -e "${CYAN}$(t SERVICE_STATUS)$(systemctl is-active $SERVICE_NAME)${NC}"
}

# 查看监控日志
view_logs() {
    show_banner
    echo -e "${CYAN}$(t LOG_TITLE)${NC}"
    if [ -f "/var/log/vps-monitor.log" ]; then
        echo -e "${YELLOW}$(t LOG_PROMPT)${NC}"
        echo ""
        tail -n 50 -f "/var/log/vps-monitor.log"
    else
        echo -e "${RED}$(t LOG_FILE_NOT_FOUND)${NC}"
        echo -e "${YELLOW}$(t TRY_SYSTEM_LOG)${NC}"
        journalctl -u "$SERVICE_NAME" -n 50 --no-pager -f
    fi
}

# 重启监控服务
restart_service() {
    show_banner
    echo -e "${CYAN}$(t RESTARTING_SERVICE_APPLY_CONFIG)${NC}"
    if systemctl is-active --quiet $SERVICE_NAME; then
        systemctl restart "$SERVICE_NAME"
        echo -e "${GREEN}$(t SERVICE_RESTARTED)${NC}"
    else
        systemctl start "$SERVICE_NAME"
        echo -e "${GREEN}$(t SERVICE_STARTED)${NC}"
    fi
    echo -e "${CYAN}$(t SERVICE_STATUS)$(systemctl is-active $SERVICE_NAME)${NC}"
}

# 修改配置
change_config() {
    show_banner
    echo -e "${CYAN}$(t MODIFY_CONFIG_TITLE)${NC}"
    echo -e "${YELLOW}$(t MODIFY_PROMPT)${NC}"
    echo ""

    load_config || { echo -e "${RED}$(t ERROR_LOAD_CONFIG)$CONFIG_FILE$(t UNKNOWN_PARAM) $(t PLEASE_INSTALL_FIRST_ZH) ${NC}"; return 1; } # Simplified this part

    local new_api_key="" new_server_id="" new_worker_url=""
    read -p "$(t NEW_API_KEY_PROMPT)${API_KEY}]: " new_api_key
    API_KEY="${new_api_key:-$API_KEY}"
    read -p "$(t NEW_SERVER_ID_PROMPT)${SERVER_ID}]: " new_server_id
    SERVER_ID="${new_server_id:-$SERVER_ID}"
    read -p "$(t NEW_WORKER_URL_PROMPT)${WORKER_URL}]: " new_worker_url
    WORKER_URL="${new_worker_url:-$WORKER_URL}"

    echo -e "${YELLOW}$(t SAVING_CONFIG)${NC}"
    save_config
    echo -e "${YELLOW}$(t UPDATING_SCRIPT)${NC}"
    create_monitor_script
    echo -e "${YELLOW}$(t RESTARTING_SERVICE_APPLY_CONFIG)${NC}"
    restart_service
    echo -e "${GREEN}$(t CONFIG_SAVED_RESTARTED)${NC}"
}

# 主菜单
show_menu() {
    while true; do
        show_banner
        echo -e "${CYAN}$(t MENU_SELECT_ACTION)${NC}"
        echo -e "  ${GREEN}1.${NC}$(t MENU_ITEM_1)"
        echo -e "  ${GREEN}2.${NC}$(t MENU_ITEM_2)"
        echo -e "  ${GREEN}3.${NC}$(t MENU_ITEM_3)"
        echo -e "  ${GREEN}4.${NC}$(t MENU_ITEM_4)"
        echo -e "  ${GREEN}5.${NC}$(t MENU_ITEM_5)"
        echo -e "  ${GREEN}6.${NC}$(t MENU_ITEM_6)"
        echo -e "  ${GREEN}7.${NC}$(t MENU_ITEM_7)"
        echo -e "  ${GREEN}0.${NC}$(t MENU_ITEM_0)"
        echo ""
        read -p "$(t MENU_PROMPT)" choice
        
        case $choice in
            1) install_monitor ;;
            2) uninstall_monitor ;;
            3) check_status ;;
            4) view_logs ;;
            5) stop_service ;;
            6) restart_service ;;
            7) change_config ;;
            0) exit 0 ;;
            *) echo -e "${RED}$(t INVALID_CHOICE)${NC}" ;;
        esac
        echo ""
        read -p "$(t PRESS_ENTER)"
    done
}

# 解析命令行参数
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            -k|--key) API_KEY="$2"; shift 2 ;;
            -s|--server) SERVER_ID="$2"; shift 2 ;;
            -u|--url) WORKER_URL="$2"; shift 2 ;;
            -d|--dir) INSTALL_DIR="$2"; shift 2 ;;
            -i|--install) DIRECT_INSTALL=1; shift ;;
            -l|--lang) ARG_LANG="$2"; shift 2 ;; # Language argument
            -h|--help) show_help; exit 0 ;;
            *) echo -e "${RED}$(t UNKNOWN_PARAM) $1${NC}"; show_help; exit 1 ;;
        esac
    done
}

# 显示帮助信息
show_help() {
    # 确保在显示帮助前选择语言或使用默认语言
    if [ -z "$CURRENT_LANG_INITIALIZED" ]; then
      select_language # Ensure language is set for help text
      CURRENT_LANG_INITIALIZED=1
    fi
    echo "$(t HELP_USAGE) $0 [$(t HELP_OPTIONS)]"
    echo ""
    echo "$(t HELP_OPTIONS):"
    echo "$(t HELP_API_KEY)"
    echo "$(t HELP_SERVER_ID)"
    echo "$(t HELP_WORKER_URL)"
    echo "$(t HELP_INSTALL_DIR)"
    echo "$(t HELP_DIRECT_INSTALL)"
    echo "$(t HELP_LANGUAGE)"
    echo "$(t HELP_HELP)"
    echo ""
    echo "$(t HELP_EXAMPLE):"
    echo "  $0                  $(t HELP_EXAMPLE_MENU)"
    echo "  $0 -i -k API_KEY -s SERVER_ID -u https://example.workers.dev $(t HELP_EXAMPLE_DIRECT)"
}

# 主函数
main() {
    check_root
    load_config
    parse_args "$@" # Parse args first to get language if provided

    if [ -z "$DIRECT_INSTALL" ]; then # Only show language prompt if not direct install
        select_language
        CURRENT_LANG_INITIALIZED=1
    elif [ -n "$ARG_LANG" ]; then # If direct install and lang arg is present
        CURRENT_LANG="$ARG_LANG" # Set current language from arg
        CURRENT_LANG_INITIALIZED=1
    else # Direct install, no lang arg, default to English
        CURRENT_LANG="en"
        CURRENT_LANG_INITIALIZED=1
    fi


    if [ "$DIRECT_INSTALL" = "1" ]; then
        if [ -z "$API_KEY" ] || [ -z "$SERVER_ID" ] || [ -z "$WORKER_URL" ]; then
             echo -e "${RED}For direct install (-i), API Key (-k), Server ID (-s), and Worker URL (-u) are required.${NC}"
             show_help
             exit 1
        fi
        install_monitor
    else
        show_menu
    fi
}

main "$@"