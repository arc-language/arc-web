page "Chat"
  @state let message = ""
  @state let username = "Guest"
  @realtime let messages = channel("chat/general")

  @server fn sendMessage(text: String, sender: String) -> none
    return none

  header
    heading "Chat — General"

  main
    card
      text "Messages:"
      text "{messages}"

    card
      heading "Send a message"
      input bind:value={message} placeholder="Type a message..."
      button on:click={ await sendMessage(message, username) } "Send"
