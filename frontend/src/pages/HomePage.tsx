import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { useUser, UserButton } from "@clerk/clerk-react"
import { motion } from "motion/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import { Layers, Check, ArrowRight, Menu, X, Users, BarChart3, Sparkles, Shield, Mail, Phone, MapPin, Github, Twitter, Linkedin, Play } from "lucide-react"
import { ThemeToggle } from "@/components/ui/theme-toggle"

// Animated Shape Component for Hero
function ElegantShape({
  className,
  delay = 0,
  rotate = 0,
  gradient = "from-primary/[0.08]",
}: {
  className?: string
  delay?: number
  rotate?: number
  gradient?: string
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -150, rotate: rotate - 15 }}
      animate={{ opacity: 1, y: 0, rotate: rotate }}
      transition={{
        duration: 2.4,
        delay,
        ease: [0.23, 0.86, 0.39, 0.96],
        opacity: { duration: 1.2 },
      }}
      className={cn("absolute", className)}
    >
      <motion.div
        animate={{ y: [0, 15, 0] }}
        transition={{
          duration: 12,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        className="relative w-full h-full"
      >
        <div
          className={cn(
            "absolute inset-0 rounded-full",
            "bg-gradient-to-r to-transparent",
            gradient,
            "backdrop-blur-[2px] border-2 border-primary/[0.15]",
            "shadow-[0_8px_32px_0_rgba(93,78,55,0.1)]",
            "after:absolute after:inset-0 after:rounded-full",
            "after:bg-[radial-gradient(circle_at_50%_50%,rgba(93,78,55,0.2),transparent_70%)]"
          )}
        />
      </motion.div>
    </motion.div>
  )
}

export default function HomePage() {
  const { isSignedIn, user } = useUser()
  const navigate = useNavigate()
  const [isYearly, setIsYearly] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  const handleSignUp = () => navigate('/get-started')
  const handleSignIn = () => navigate('/sign-in')

  // Handle scroll effect for navbar
  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20)
    }
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  const fadeUpVariants = {
    hidden: { opacity: 0, y: 30 },
    visible: (i: number) => ({
      opacity: 1,
      y: 0,
      transition: {
        duration: 1,
        delay: 0.5 + i * 0.2,
        ease: [0.25, 0.4, 0.25, 1] as [number, number, number, number],
      },
    }),
  }

  const navLinks = [
    { name: "Features", href: "#features" },
    { name: "Pricing", href: "#pricing" },
    { name: "Testimonials", href: "#testimonials" },
    { name: "FAQ", href: "#faq" },
    { name: "Contact", href: "#contact" },
  ]

  return (
    <div className="min-h-screen bg-background text-foreground antialiased overflow-x-hidden selection:bg-primary selection:text-primary-foreground">

      {/* Modern Animated Navbar with Scroll-Based Container */}
      <header>
        <nav data-state={mobileMenuOpen && "active"} className="fixed z-50 w-full px-2 group">
          <motion.div
            initial={{ y: -100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.6, ease: [0.25, 0.4, 0.25, 1] }}
            className={cn(
              "mx-auto mt-2 max-w-6xl px-6 transition-all duration-300 lg:px-12",
              scrolled && "bg-background/80 max-w-4xl rounded-2xl border border-border/50 backdrop-blur-lg shadow-lg lg:px-5"
            )}
          >
            <div className="relative flex flex-wrap items-center justify-between gap-6 py-3 lg:gap-0 lg:py-4">
              {/* Left: Logo */}
              <div className="flex w-full justify-between lg:w-auto">
                <motion.a
                  href="#"
                  className="flex items-center gap-2.5 group/logo"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <motion.div
                    className="w-9 h-9 bg-primary rounded-xl flex items-center justify-center shadow-lg shadow-primary/25 group-hover/logo:shadow-primary/40 transition-shadow"
                    whileHover={{ rotate: 5 }}
                  >
                    <Layers className="h-5 w-5 text-primary-foreground" />
                  </motion.div>
                  <span className="text-xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-primary to-primary/80">
                    LearnTrack
                  </span>
                </motion.a>

                {/* Mobile Menu Toggle */}
                <button
                  onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                  aria-label={mobileMenuOpen ? "Close Menu" : "Open Menu"}
                  className="relative z-20 -m-2.5 -mr-4 block cursor-pointer p-2.5 lg:hidden"
                >
                  <Menu className="group-data-[state=active]:rotate-180 group-data-[state=active]:scale-0 group-data-[state=active]:opacity-0 m-auto size-6 duration-200 text-muted-foreground" />
                  <X className="group-data-[state=active]:rotate-0 group-data-[state=active]:scale-100 group-data-[state=active]:opacity-100 absolute inset-0 m-auto size-6 -rotate-180 scale-0 opacity-0 duration-200 text-muted-foreground" />
                </button>
              </div>

              {/* Center: Desktop Nav Links */}
              <div className="absolute inset-0 m-auto hidden size-fit lg:block">
                <ul className="flex gap-8 text-sm">
                  {navLinks.map((link, index) => (
                    <li key={link.name}>
                      <motion.a
                        href={link.href}
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.1 * index }}
                        className="text-muted-foreground hover:text-primary block duration-150 font-medium"
                      >
                        {link.name}
                      </motion.a>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Right: Actions */}
              <div className="hidden lg:flex items-center gap-3">
                <ThemeToggle />

                {isSignedIn ? (
                  <div className="flex items-center gap-2">
                    <motion.div
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      transition={{ type: "spring", stiffness: 400, damping: 17 }}
                    >
                      <Button
                        onClick={() => navigate('/dashboard')}
                        size="sm"
                        className="h-8 px-3 text-xs bg-primary text-primary-foreground rounded-full font-medium shadow-md hover:bg-primary/90 transition-all"
                      >
                        Dashboard
                      </Button>
                    </motion.div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {user?.firstName || user?.emailAddresses[0]?.emailAddress?.split('@')[0]}
                      </span>
                      <UserButton
                        afterSignOutUrl="/"
                        appearance={{
                          elements: {
                            avatarBox: "w-8 h-8 ring-2 ring-primary/20"
                          }
                        }}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <motion.div
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      transition={{ type: "spring", stiffness: 400, damping: 17 }}
                      className={cn(scrolled && "lg:hidden")}
                    >
                      <Button
                        onClick={handleSignIn}
                        variant="ghost"
                        size="sm"
                        className="h-8 px-3 text-xs"
                      >
                        Sign In
                      </Button>
                    </motion.div>
                    <motion.div
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      transition={{ type: "spring", stiffness: 400, damping: 17 }}
                    >
                      <Button
                        onClick={handleSignUp}
                        size="sm"
                        className="h-8 px-3 text-xs bg-primary text-primary-foreground rounded-full font-medium shadow-md hover:bg-primary/90 transition-all"
                      >
                        Start Free Trial
                      </Button>
                    </motion.div>
                  </div>
                )}
              </div>
            </div>
          </motion.div>

          {/* Mobile Menu - Dropdown */}
          <div className={cn(
            "bg-background group-data-[state=active]:block lg:group-data-[state=active]:flex",
            "mb-6 hidden w-full flex-wrap items-center justify-end space-y-8 rounded-3xl border p-6 shadow-2xl shadow-zinc-300/20 md:flex-nowrap",
            "lg:m-0 lg:flex lg:w-fit lg:gap-6 lg:space-y-0 lg:border-transparent lg:bg-transparent lg:p-0 lg:shadow-none",
            "dark:shadow-none dark:lg:bg-transparent"
          )}>
            <div className="lg:hidden">
              <ul className="space-y-6 text-base">
                {navLinks.map((link) => (
                  <li key={link.name}>
                    <a
                      href={link.href}
                      onClick={() => setMobileMenuOpen(false)}
                      className="text-muted-foreground hover:text-primary block duration-150"
                    >
                      {link.name}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex w-full flex-col space-y-3 sm:flex-row sm:gap-3 sm:space-y-0 md:w-fit lg:hidden">
              <ThemeToggle />
              {!isSignedIn ? (
                <>
                  <Button asChild variant="outline" size="sm">
                    <a onClick={() => { handleSignIn(); setMobileMenuOpen(false); }}>Sign In</a>
                  </Button>
                  <Button
                    onClick={() => { handleSignUp(); setMobileMenuOpen(false); }}
                    size="sm"
                    className="bg-primary text-primary-foreground"
                  >
                    Start Free Trial
                  </Button>
                </>
              ) : (
                <Button
                  onClick={() => { navigate('/dashboard'); setMobileMenuOpen(false); }}
                  size="sm"
                  className="bg-primary text-primary-foreground"
                >
                  Dashboard
                </Button>
              )}
            </div>
          </div>
        </nav>
      </header>

      {/* Hero Section with Animated Shapes */}
      <section className="relative min-h-[90vh] md:min-h-screen w-full flex items-center justify-center overflow-hidden bg-background">
        <div className="absolute inset-0 -z-10 size-full [background:radial-gradient(100%_100%_at_50%_100%,transparent_0%,hsl(var(--background))_70%)] sm:[background:radial-gradient(125%_125%_at_50%_100%,transparent_0%,hsl(var(--background))_75%)]" />
        <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.03] sm:from-primary/[0.04] md:from-primary/[0.05] via-transparent to-accent/[0.03] sm:to-accent/[0.04] md:to-accent/[0.05] blur-3xl" />

        <div className="absolute inset-0 overflow-hidden">
          <ElegantShape
            delay={0.3}
            rotate={12}
            gradient="from-primary/[0.08] sm:from-primary/[0.12] md:from-primary/[0.15]"
            className="w-[280px] h-[60px] sm:w-[400px] sm:h-[100px] md:w-[500px] md:h-[120px] lg:w-[600px] lg:h-[140px] left-[-15%] sm:left-[-10%] md:left-[-5%] top-[12%] sm:top-[15%] md:top-[20%] opacity-60 sm:opacity-80 md:opacity-100"
          />
          <ElegantShape
            delay={0.5}
            rotate={-15}
            gradient="from-accent/[0.08] sm:from-accent/[0.12] md:from-accent/[0.15]"
            className="w-[240px] h-[50px] sm:w-[350px] sm:h-[90px] md:w-[450px] md:h-[110px] lg:w-[500px] lg:h-[120px] right-[-10%] sm:right-[-5%] md:right-[0%] top-[65%] sm:top-[70%] md:top-[75%] opacity-60 sm:opacity-80 md:opacity-100"
          />
          <ElegantShape
            delay={0.4}
            rotate={-8}
            gradient="from-primary/[0.06] sm:from-primary/[0.10] md:from-primary/[0.12]"
            className="hidden sm:block w-[200px] h-[50px] md:w-[280px] md:h-[70px] lg:w-[300px] lg:h-[80px] left-[0%] md:left-[10%] bottom-[8%] md:bottom-[10%] opacity-50 sm:opacity-70 md:opacity-100"
          />
          <ElegantShape
            delay={0.6}
            rotate={20}
            gradient="from-accent/[0.05] sm:from-accent/[0.08] md:from-accent/[0.10]"
            className="hidden md:block w-[150px] h-[40px] lg:w-[200px] lg:h-[60px] right-[10%] lg:right-[20%] top-[20%] lg:top-[30%] opacity-50 md:opacity-80"
          />
        </div>

        <div className="relative z-10 mx-auto w-full max-w-7xl px-6 md:px-8">
          <div className="text-center">
            <motion.div
              custom={0}
              variants={fadeUpVariants}
              initial="hidden"
              animate="visible"
              className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 border border-primary/20 mb-8 md:mb-10"
            >
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-sm text-primary tracking-wide font-medium">
                Trusted by 10,000+ Educators
              </span>
            </motion.div>

            <motion.h1
              custom={1}
              variants={fadeUpVariants}
              initial="hidden"
              animate="visible"
              className="max-w-5xl mx-auto text-balance text-4xl sm:text-5xl md:text-6xl lg:text-7xl xl:text-[5.5rem] font-bold tracking-tight"
            >
              <span className="bg-clip-text text-transparent bg-gradient-to-b from-foreground to-foreground/80">
                Stop Wasting Hours
              </span>
              <br />
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-primary via-accent to-primary">
                Creating Assignments
              </span>
            </motion.h1>

            <motion.p
              custom={2}
              variants={fadeUpVariants}
              initial="hidden"
              animate="visible"
              className="mx-auto mt-6 max-w-xl text-balance text-sm sm:text-base text-muted-foreground leading-relaxed"
            >
              AI-powered question generation, student tracking, and parent engagement.{" "}
              <span className="text-foreground font-medium">All for less than a coffee per week.</span>
            </motion.p>

            <motion.div
              custom={3}
              variants={fadeUpVariants}
              initial="hidden"
              animate="visible"
              className="mt-6 md:mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row"
            >
              <motion.div
                whileHover={{ scale: 1.05, y: -2 }}
                whileTap={{ scale: 0.95 }}
                transition={{ type: "spring", stiffness: 400, damping: 17 }}
              >
                <Button
                  onClick={handleSignUp}
                  size="default"
                  className="rounded-full px-6 h-10 text-sm font-medium bg-primary hover:bg-primary/90 shadow-lg shadow-primary/30 hover:shadow-primary/40 transition-shadow"
                >
                  Start Free Trial
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </motion.div>
              <motion.div
                whileHover={{ scale: 1.05, y: -2 }}
                whileTap={{ scale: 0.95 }}
                transition={{ type: "spring", stiffness: 400, damping: 17 }}
              >
                <Button
                  variant="outline"
                  size="default"
                  className="rounded-full px-6 h-10 text-sm font-medium border-primary/20 hover:bg-primary/10 hover:border-primary/30 transition-colors"
                >
                  <Play className="mr-2 h-4 w-4" />
                  Watch Demo
                </Button>
              </motion.div>
            </motion.div>

            <motion.p
              custom={4}
              variants={fadeUpVariants}
              initial="hidden"
              animate="visible"
              className="mt-5 text-xs text-muted-foreground"
            >
              No credit card required • Setup in 2 minutes • Cancel anytime
            </motion.p>
          </div>
        </div>
      </section>

      {/* Proof Section - Stats */}
      <section className="bg-muted/50 overflow-hidden py-16 md:py-20">
        <div className="group relative mx-auto max-w-7xl px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-12">
            {[
              { value: "10,000+", label: "Active Educators", sublabel: "and growing daily" },
              { value: "2M+", label: "Questions Generated", sublabel: "last month alone" },
              { value: "5+ hrs", label: "Saved Weekly", sublabel: "per educator" },
              { value: "98%", label: "Would Recommend", sublabel: "to colleagues" },
            ].map((stat, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
                viewport={{ once: true }}
                className="text-center"
              >
                <div className="text-4xl md:text-5xl font-bold text-primary mb-2">
                  {stat.value}
                </div>
                <div className="text-sm font-semibold text-foreground">{stat.label}</div>
                <div className="text-xs text-muted-foreground mt-1">{stat.sublabel}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="dark:bg-muted/25 bg-background py-16 md:py-32">
        <div className="mx-auto max-w-6xl px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12"
          >
            <span className="inline-block px-4 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium mb-4">
              Why LearnTrack?
            </span>
            <h2 className="text-4xl font-bold mb-4 md:text-5xl">
              Everything You Need to <span className="text-primary">Teach Smarter</span>
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Stop juggling multiple tools. LearnTrack combines AI-powered question generation,
              progress tracking, and parent communication in one seamless platform.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                icon: <Sparkles className="h-6 w-6" />,
                title: "AI Question Generator",
                description: "Create 50 curriculum-aligned questions in 30 seconds. Specify difficulty, format, and topic—AI handles the rest.",
                highlight: "Save 3+ hours weekly",
              },
              {
                icon: <BarChart3 className="h-6 w-6" />,
                title: "Smart Analytics Dashboard",
                description: "See which students are struggling before they fall behind. Identify knowledge gaps with visual performance maps.",
                highlight: "Data-driven decisions",
              },
              {
                icon: <Users className="h-6 w-6" />,
                title: "Parent Portal",
                description: "Parents see real-time grades, upcoming assignments, and can message you directly. No more email chains.",
                highlight: "Increase engagement 3x",
              },
              {
                icon: <Shield className="h-6 w-6" />,
                title: "Enterprise Security",
                description: "FERPA & COPPA compliant. 256-bit encryption. SOC 2 certified. Your students' data is never sold or shared.",
                highlight: "100% compliant",
              },
            ].map((feature, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
                viewport={{ once: true }}
                className="group"
              >
                <Card className="h-full shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-1">
                  <CardContent className="p-6">
                    <div className="mb-4 inline-flex p-3 rounded-xl bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-all duration-300">
                      {feature.icon}
                    </div>
                    <h3 className="text-lg font-semibold mb-2">{feature.title}</h3>
                    <p className="text-muted-foreground text-sm mb-4 leading-relaxed">{feature.description}</p>
                    <span className="inline-block text-xs font-medium text-primary bg-primary/10 px-3 py-1 rounded-full">
                      {feature.highlight}
                    </span>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mt-12"
          >
            <motion.div
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              transition={{ type: "spring", stiffness: 400, damping: 17 }}
              className="inline-block"
            >
              <Button onClick={handleSignUp} size="sm" className="rounded-full px-5 h-9 bg-primary hover:bg-primary/90 shadow-md">
                Try All Features Free <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Button>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Testimonials Section with Infinite Slider */}
      <section id="testimonials" className="bg-background text-foreground py-16 sm:py-24 md:py-32 px-0">
        <div className="mx-auto flex max-w-7xl flex-col items-center gap-8 text-center sm:gap-16">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="flex flex-col items-center gap-4 px-4 sm:gap-6"
          >
            <span className="inline-block px-4 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium">
              Real Results
            </span>
            <h2 className="max-w-[720px] text-3xl font-bold leading-tight sm:text-5xl sm:leading-tight">
              Educators <span className="text-primary">Love LearnTrack</span>
            </h2>
            <p className="text-md max-w-[600px] font-medium text-muted-foreground sm:text-xl">
              Join thousands of teachers who've reclaimed their evenings and weekends
            </p>
          </motion.div>

          {/* Infinite Marquee Slider */}
          <div className="relative flex w-full flex-col items-center justify-center overflow-hidden">
            <div
              className="group flex overflow-hidden p-2 flex-row"
              style={{ "--gap": "1.5rem", "--duration": "40s" } as React.CSSProperties}
            >
              <div className="flex shrink-0 justify-around gap-[var(--gap)] animate-marquee flex-row group-hover:[animation-play-state:paused]">
                {/* Repeat testimonials for seamless loop */}
                {[...Array(2)].map((_, setIndex) =>
                  [
                    {
                      name: "Sarah Mitchell",
                      handle: "@sarahmitchell_edu",
                      avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&h=150&fit=crop&crop=face",
                      text: "I used to spend 5 hours every weekend creating quizzes. Now it takes me 10 minutes. LearnTrack's AI understands exactly what I need. Saved 20+ hours monthly!",
                    },
                    {
                      name: "Michael Johnson",
                      handle: "@mjohnson_principal",
                      avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&h=150&fit=crop&crop=face",
                      text: "We rolled this out to 50 teachers. Parent engagement increased 3x and our teachers finally have time for what matters—teaching.",
                    },
                    {
                      name: "Jennifer Park",
                      handle: "@jpark_science",
                      avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&h=150&fit=crop&crop=face",
                      text: "The analytics showed me which students were struggling before their grades dropped. I intervened early and saw a 25% improvement in test scores.",
                    },
                    {
                      name: "David Chen",
                      handle: "@dchen_mathteacher",
                      avatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&h=150&fit=crop&crop=face",
                      text: "LearnTrack changed how I approach assessments. The AI-generated questions are curriculum-aligned and actually challenge my students.",
                    },
                    {
                      name: "Emily Rodriguez",
                      handle: "@emily_teaches",
                      avatar: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=150&h=150&fit=crop&crop=face",
                      text: "Parents love the progress reports! They can finally see exactly where their child needs help. Communication has never been easier.",
                    },
                    {
                      name: "James Wilson",
                      handle: "@jwilson_stem",
                      avatar: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150&h=150&fit=crop&crop=face",
                      text: "Best investment our district made. Setup took 2 minutes, and we had 100% teacher adoption within a week. The interface is that intuitive.",
                    },
                  ].map((testimonial, i) => (
                    <div
                      key={`${setIndex}-${i}`}
                      className={cn(
                        "flex flex-col rounded-xl border-t",
                        "bg-gradient-to-b from-muted/50 to-muted/10",
                        "p-5 text-start sm:p-6",
                        "hover:from-muted/60 hover:to-muted/20",
                        "max-w-[320px] sm:max-w-[340px]",
                        "transition-colors duration-300 shadow-lg shadow-primary/5"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <Avatar className="h-12 w-12 ring-2 ring-primary/20">
                          <AvatarImage src={testimonial.avatar} alt={testimonial.name} />
                          <AvatarFallback className="bg-primary text-primary-foreground font-semibold">
                            {testimonial.name.split(' ').map(n => n[0]).join('')}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex flex-col items-start">
                          <h3 className="text-md font-semibold leading-none">{testimonial.name}</h3>
                          <p className="text-sm text-muted-foreground">{testimonial.handle}</p>
                        </div>
                      </div>
                      <p className="sm:text-md mt-4 text-sm text-muted-foreground leading-relaxed">{testimonial.text}</p>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Gradient overlays for fade effect */}
            <div className="pointer-events-none absolute inset-y-0 left-0 hidden w-1/4 bg-gradient-to-r from-background sm:block" />
            <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-1/4 bg-gradient-to-l from-background sm:block" />
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section id="faq" className="bg-background py-16 md:py-32">
        <div className="mx-auto max-w-5xl px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12"
          >
            <span className="inline-block px-4 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium mb-4">
              Got Questions?
            </span>
            <h2 className="text-4xl font-bold mb-4 md:text-5xl">
              Frequently Asked <span className="text-primary">Questions</span>
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Everything you need to know before getting started
            </p>
          </motion.div>

          <div className="mx-auto max-w-3xl">
            <Accordion type="single" collapsible className="space-y-3">
              {[
                {
                  question: "Can I really try it free for 14 days?",
                  answer: "Yes! Your free trial includes full access to all Pro features—unlimited question generation, analytics, parent portal, everything. No credit card required to start. After 14 days, you can continue on our free plan or upgrade to Pro.",
                },
                {
                  question: "How long does setup take?",
                  answer: "Most educators are up and running in under 2 minutes. Just sign up, add your first class, and start generating questions. We also have quick-start guides and video tutorials if you want to explore advanced features.",
                },
                {
                  question: "Will the AI questions match my curriculum?",
                  answer: "Absolutely. You can specify grade level, subject, topic, difficulty, and question format. Our AI is trained on educational standards including Common Core, NGSS, and state-specific curricula. Questions are always editable so you have full control.",
                },
                {
                  question: "Can I cancel anytime?",
                  answer: "Yes, you can cancel your subscription at any time with no questions asked. Your access continues until the end of your billing period. We also offer a 30-day money-back guarantee if you're not satisfied.",
                },
                {
                  question: "Is my students' data safe?",
                  answer: "Security is our top priority. We're FERPA and COPPA compliant, use 256-bit encryption, and are SOC 2 certified. We never sell or share student data with third parties. Period.",
                },
                {
                  question: "What LMS integrations are available?",
                  answer: "We integrate with Google Classroom, Canvas, Schoology, and Clever. Enterprise plans include custom integrations with any LMS. Syncing grades and assignments is automatic.",
                },
              ].map((faq, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  viewport={{ once: true }}
                >
                  <AccordionItem
                    value={`item-${index}`}
                    className="border border-border rounded-xl px-6 bg-card shadow-sm hover:shadow-md hover:border-primary/30 transition-all"
                  >
                    <AccordionTrigger className="text-left hover:no-underline py-5 font-medium">
                      {faq.question}
                    </AccordionTrigger>
                    <AccordionContent className="text-muted-foreground pb-5 leading-relaxed">
                      {faq.answer}
                    </AccordionContent>
                  </AccordionItem>
                </motion.div>
              ))}
            </Accordion>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="bg-muted/30 py-16 md:py-32">
        <div className="mx-auto max-w-6xl px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12"
          >
            <span className="inline-block px-4 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium mb-4">
              Less Than a Coffee Per Week
            </span>
            <h2 className="text-4xl font-bold mb-4 md:text-5xl">
              Simple, <span className="text-primary">Transparent Pricing</span>
            </h2>
            <p className="text-muted-foreground text-lg max-w-xl mx-auto mb-8">
              Start free. Upgrade when you're ready. Cancel anytime.
            </p>

            <div className="inline-flex items-center gap-1 p-1 bg-muted rounded-full border">
              <button
                onClick={() => setIsYearly(false)}
                className={cn(
                  "px-5 py-2 rounded-full transition-all font-medium text-sm",
                  !isYearly ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                Monthly
              </button>
              <button
                onClick={() => setIsYearly(true)}
                className={cn(
                  "px-5 py-2 rounded-full transition-all font-medium text-sm",
                  isYearly ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                Yearly <span className="ml-1 text-xs px-2 py-0.5 bg-green-500/20 text-green-600 rounded-full">Save 20%</span>
              </button>
            </div>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                name: "Starter",
                description: "Try LearnTrack risk-free",
                price: 0,
                period: "forever",
                features: [
                  "50 AI-generated questions/month",
                  "Basic progress tracking",
                  "Email support",
                  "1 class (up to 30 students)",
                ],
                popular: false,
                cta: "Start Free",
              },
              {
                name: "Pro",
                description: "Best for individual teachers",
                price: isYearly ? 19 : 24,
                period: isYearly ? "billed annually" : "billed monthly",
                features: [
                  "Unlimited AI questions",
                  "Advanced analytics dashboard",
                  "Parent portal access",
                  "Unlimited classes",
                  "Priority email & chat support",
                  "Custom branding",
                ],
                popular: true,
                cta: "Start 14-Day Free Trial",
              },
              {
                name: "School",
                description: "For schools & districts",
                price: null,
                period: "custom billing",
                features: [
                  "Everything in Pro",
                  "Unlimited teachers",
                  "LMS integrations (Google, Canvas)",
                  "Dedicated success manager",
                  "Admin controls & reporting",
                  "SLA guarantees",
                ],
                popular: false,
                cta: "Contact Sales",
              },
            ].map((plan, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
                viewport={{ once: true }}
              >
                <Card className={cn(
                  "h-full relative transition-all duration-300 hover:-translate-y-1",
                  plan.popular
                    ? "border-primary shadow-xl shadow-primary/20 md:scale-105"
                    : "shadow-lg hover:shadow-xl"
                )}>
                  {plan.popular && (
                    <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-full shadow-lg">
                      Most Popular
                    </div>
                  )}
                  <CardHeader className="text-center pb-4 pt-8">
                    <h3 className="text-xl font-bold mb-1">{plan.name}</h3>
                    <p className="text-sm text-muted-foreground mb-4">{plan.description}</p>
                    <div className="text-4xl md:text-5xl font-bold">
                      {plan.price !== null ? (
                        <>
                          ${plan.price}
                          <span className="text-base text-muted-foreground font-normal">/mo</span>
                        </>
                      ) : (
                        "Custom"
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{plan.period}</p>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <ul className="space-y-3 mb-6">
                      {plan.features.map((feature, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <Check className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                          <span className="text-sm">{feature}</span>
                        </li>
                      ))}
                    </ul>
                    <motion.div
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      transition={{ type: "spring", stiffness: 400, damping: 17 }}
                    >
                      <Button
                        onClick={plan.price !== null ? handleSignUp : undefined}
                        size="sm"
                        className={cn(
                          "w-full font-medium rounded-xl h-9",
                          plan.popular
                            ? "bg-primary hover:bg-primary/90 shadow-lg shadow-primary/25"
                            : "bg-muted hover:bg-muted/80 text-foreground"
                        )}
                      >
                        {plan.cta}
                      </Button>
                    </motion.div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center text-sm text-muted-foreground mt-12"
          >
            All plans include: 30-day money-back guarantee • 256-bit SSL encryption • 99.9% uptime SLA
          </motion.p>
        </div>
      </section>

      {/* Contact Section */}
      <section id="contact" className="bg-background py-16 md:py-32">
        <div className="mx-auto max-w-5xl px-6">
          <div className="grid md:grid-cols-2 gap-12 items-start">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
            >
              <span className="inline-block px-4 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium mb-4">
                Get in Touch
              </span>
              <h2 className="text-4xl font-bold mb-4 md:text-5xl">
                Ready to Transform <span className="text-primary">Your Classroom?</span>
              </h2>
              <p className="text-muted-foreground text-lg mb-8">
                Have questions about LearnTrack? Want a personalized demo for your school?
                Our education specialists are here to help you get started.
              </p>

              <div className="space-y-5">
                <div className="flex items-start gap-4">
                  <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Mail className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <div className="font-semibold mb-0.5">Email Us</div>
                    <div className="text-muted-foreground text-sm">hello@learntrack.edu</div>
                    <div className="text-xs text-muted-foreground">We respond within 24 hours</div>
                  </div>
                </div>
                <div className="flex items-start gap-4">
                  <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Phone className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <div className="font-semibold mb-0.5">Call Us</div>
                    <div className="text-muted-foreground text-sm">+1 (555) 123-4567</div>
                    <div className="text-xs text-muted-foreground">Mon-Fri 9am-6pm EST</div>
                  </div>
                </div>
                <div className="flex items-start gap-4">
                  <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <MapPin className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <div className="font-semibold mb-0.5">Visit Us</div>
                    <div className="text-muted-foreground text-sm">123 Education Way, Suite 500</div>
                    <div className="text-xs text-muted-foreground">San Francisco, CA 94105</div>
                  </div>
                </div>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
            >
              <Card className="shadow-xl">
                <CardContent className="p-6">
                  <form className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="firstName" className="text-sm">First Name</Label>
                        <Input id="firstName" placeholder="John" className="h-10" />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="lastName" className="text-sm">Last Name</Label>
                        <Input id="lastName" placeholder="Smith" className="h-10" />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="email" className="text-sm">Work Email</Label>
                      <Input id="email" type="email" placeholder="john@school.edu" className="h-10" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="school" className="text-sm">School / District</Label>
                      <Input id="school" placeholder="Lincoln High School" className="h-10" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="message" className="text-sm">Message</Label>
                      <Textarea
                        id="message"
                        placeholder="Tell us about your needs..."
                        rows={3}
                      />
                    </div>
                    <motion.div
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      transition={{ type: "spring", stiffness: 400, damping: 17 }}
                    >
                      <Button size="sm" className="w-full h-9 bg-primary hover:bg-primary/90 rounded-xl shadow-lg shadow-primary/25">
                        Send Message <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                      </Button>
                    </motion.div>
                    <p className="text-xs text-center text-muted-foreground">
                      By submitting, you agree to our Privacy Policy. We'll never spam you.
                    </p>
                  </form>
                </CardContent>
              </Card>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-muted/30 border-t border-border py-12 md:py-16">
        <div className="mx-auto max-w-6xl px-6">
          <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-8 mb-10">
            <div className="sm:col-span-2 md:col-span-1">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <Layers className="h-4 w-4 text-primary-foreground" />
                </div>
                <span className="font-bold text-lg">LearnTrack</span>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                Empowering 10,000+ educators worldwide with AI-powered tools to save time and improve student outcomes.
              </p>
              <div className="flex gap-2">
                <a href="#" className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors">
                  <Twitter className="h-4 w-4" />
                </a>
                <a href="#" className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors">
                  <Linkedin className="h-4 w-4" />
                </a>
                <a href="#" className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors">
                  <Github className="h-4 w-4" />
                </a>
              </div>
            </div>
            <div>
              <h4 className="font-semibold mb-3 text-sm">Product</h4>
              <ul className="space-y-2.5 text-sm text-muted-foreground">
                <li><a href="#features" className="hover:text-primary transition-colors">Features</a></li>
                <li><a href="#pricing" className="hover:text-primary transition-colors">Pricing</a></li>
                <li><a href="#testimonials" className="hover:text-primary transition-colors">Testimonials</a></li>
                <li><a href="#faq" className="hover:text-primary transition-colors">FAQ</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-3 text-sm">Resources</h4>
              <ul className="space-y-2.5 text-sm text-muted-foreground">
                <li><a href="#" className="hover:text-primary transition-colors">Help Center</a></li>
                <li><a href="#" className="hover:text-primary transition-colors">Blog</a></li>
                <li><a href="#" className="hover:text-primary transition-colors">API Docs</a></li>
                <li><a href="#" className="hover:text-primary transition-colors">Integrations</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-3 text-sm">Company</h4>
              <ul className="space-y-2.5 text-sm text-muted-foreground">
                <li><a href="#" className="hover:text-primary transition-colors">About Us</a></li>
                <li><a href="#" className="hover:text-primary transition-colors">Careers</a></li>
                <li><a href="#contact" className="hover:text-primary transition-colors">Contact</a></li>
                <li><a href="#" className="hover:text-primary transition-colors">Press Kit</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-border pt-8 flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
            <p>© {new Date().getFullYear()} LearnTrack. All rights reserved.</p>
            <div className="flex gap-6">
              <a href="#" className="hover:text-primary transition-colors">Privacy Policy</a>
              <a href="#" className="hover:text-primary transition-colors">Terms of Service</a>
              <a href="#" className="hover:text-primary transition-colors">Cookie Policy</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
