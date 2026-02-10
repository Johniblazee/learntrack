import { MoreHorizontal } from "lucide-react"

interface UserCardProps {
  type: "student" | "teacher" | "parent" | "staff"
  count: number
  isLoading?: boolean
}

const UserCard = ({ type, count, isLoading = false }: UserCardProps) => {
  const getCardColor = (index: number) => {
    const colors = ["bg-lamaPurple", "bg-lamaYellow", "bg-lamaSky", "bg-lamaPurpleLight"]
    return colors[index % colors.length]
  }

  const typeIndex = ["student", "teacher", "parent", "staff"].indexOf(type)
  const cardColor = getCardColor(typeIndex)

  return (
    <div className={`rounded-2xl ${cardColor} p-4 flex-1 min-w-[130px]`}>
      <div className="flex justify-between items-center">
        <span className="text-[10px] bg-white px-2 py-1 rounded-full text-green-600">
          2024/25
        </span>
        <MoreHorizontal className="w-5 h-5 text-gray-600" />
      </div>
      <h1 className="text-2xl font-semibold my-4">
        {isLoading ? "..." : count.toLocaleString()}
      </h1>
      <h2 className="capitalize text-sm font-medium text-gray-500">
        {type}s
      </h2>
    </div>
  )
}

export default UserCard
